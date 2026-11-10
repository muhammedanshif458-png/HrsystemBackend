const mongoose = require('mongoose');
const env = require('../config/env');
const { connectDB, disconnectDB } = require('../config/db');
const User = require('../models/User');
const Employee = require('../models/Employee');
const logger = require('../utils/logger');

/**
 * Safely restores the Super Admin account and linked Employee record.
 * Uses a database transaction if supported.
 * Does NOT reset or modify the existing password unless resetPassword is true.
 * Preserves existing ObjectIds, employee details, and relationships.
 * Idempotent: can be executed multiple times safely.
 */
async function restoreSuperAdminAccount({
  targetEmail = (process.env.SEED_SUPER_ADMIN_EMAIL || env.seedSuperAdmin?.email || 'lysoftware@gmail.com').trim().toLowerCase(),
  targetEmployeeId = 'SA0001',
  resetPassword = false,
  newPassword = null
} = {}) {
  logger.info('================================================================');
  logger.info('   SUPER ADMIN ACCOUNT RESTORATION PROCEDURE                     ');
  logger.info('================================================================');
  logger.info(`Validating target account: Email=${targetEmail}, EmployeeID=${targetEmployeeId}`);

  const openedConnection = mongoose.connection.readyState === 0;
  if (openedConnection) {
    await connectDB();
  }

  // 1. Validate Target User
  const existingUser = await User.findOne({ email: targetEmail }).select('+password');
  if (!existingUser) {
    throw new Error(`Restoration aborted: Target User not found with email '${targetEmail}'.`);
  }

  // 2. Validate Target Employee
  const existingEmployee = await Employee.findOne({
    $or: [
      { employeeId: targetEmployeeId.toUpperCase() },
      { user: existingUser._id },
      { email: targetEmail }
    ]
  });

  if (!existingEmployee) {
    throw new Error(`Restoration aborted: Target Employee profile not found for email '${targetEmail}' or ID '${targetEmployeeId}'.`);
  }

  // Double check that employeeId matches
  if (existingEmployee.employeeId !== targetEmployeeId.toUpperCase()) {
    logger.warn(`Existing Employee has employeeId '${existingEmployee.employeeId}'. Aligning to '${targetEmployeeId.toUpperCase()}'.`);
  }

  // 3. Pre-Restoration Snapshot
  const beforeSnapshot = {
    user: {
      id: existingUser._id.toString(),
      email: existingUser.email,
      role: existingUser.role,
      isActive: existingUser.isActive,
      hasPasswordHash: Boolean(existingUser.password),
      passwordHashPrefix: existingUser.password ? existingUser.password.substring(0, 10) + '...' : 'none'
    },
    employee: {
      id: existingEmployee._id.toString(),
      employeeId: existingEmployee.employeeId,
      department: existingEmployee.department,
      designation: existingEmployee.designation,
      status: existingEmployee.status,
      isDeleted: existingEmployee.isDeleted,
      deletedAt: existingEmployee.deletedAt,
      linkedUser: existingEmployee.user ? existingEmployee.user.toString() : null
    }
  };

  logger.info('--- BEFORE RESTORATION SNAPSHOT ---');
  logger.info(`User: ID=${beforeSnapshot.user.id}, Email=${beforeSnapshot.user.email}, Role=${beforeSnapshot.user.role}, Active=${beforeSnapshot.user.isActive}`);
  logger.info(`Employee: ID=${beforeSnapshot.employee.id}, EmpId=${beforeSnapshot.employee.employeeId}, Status=${beforeSnapshot.employee.status}, isDeleted=${beforeSnapshot.employee.isDeleted}, deletedAt=${beforeSnapshot.employee.deletedAt}`);

  // Check if already in desired state
  const isAlreadyRestored =
    existingUser.role === 'SUPER_ADMIN' &&
    existingUser.isActive === true &&
    existingEmployee.status === 'ACTIVE' &&
    existingEmployee.isDeleted === false &&
    existingEmployee.deletedAt === null &&
    existingEmployee.user && existingEmployee.user.toString() === existingUser._id.toString() &&
    !resetPassword;

  if (isAlreadyRestored) {
    logger.info('✓ Target account is already fully restored, active, and properly linked. No changes required.');
    if (openedConnection) {
      await disconnectDB();
    }
    return {
      success: true,
      restored: false,
      alreadyActive: true,
      user: existingUser,
      employee: existingEmployee,
      before: beforeSnapshot,
      after: beforeSnapshot
    };
  }

  // 4. Check if replica set / transactions are supported
  let session = null;
  let useTransaction = false;

  try {
    const hello = await mongoose.connection.db.command({ hello: 1 });
    const isReplicaSet = Boolean(hello.setName || hello.msg === 'isdbgrid');
    if (isReplicaSet) {
      session = await mongoose.startSession();
      session.startTransaction();
      useTransaction = true;
      logger.info('Replica set detected. MongoDB transaction started for atomic restoration.');
    } else {
      logger.info('Standalone MongoDB detected (transactions not supported). Using compensatory atomic sequence.');
    }
  } catch (err) {
    logger.warn(`Transaction initialization bypassed: ${err.message}. Proceeding with safe sequence.`);
    if (session) {
      await session.endSession();
      session = null;
    }
  }

  const savedPasswordHash = existingUser.password;
  const originalUserActive = existingUser.isActive;
  const originalUserRole = existingUser.role;

  try {
    const userUpdate = {
      role: 'SUPER_ADMIN',
      isActive: true
    };

    if (resetPassword && newPassword) {
      existingUser.password = newPassword; // triggers bcrypt pre-save
      existingUser.role = 'SUPER_ADMIN';
      existingUser.isActive = true;
      if (session) {
        await existingUser.save({ session });
      } else {
        await existingUser.save();
      }
      logger.info('User password explicitly reset as requested.');
    } else {
      // Preserve existing password hash completely
      if (session) {
        await User.updateOne({ _id: existingUser._id }, { $set: userUpdate }, { session });
      } else {
        await User.updateOne({ _id: existingUser._id }, { $set: userUpdate });
      }
      logger.info('User role set to SUPER_ADMIN, isActive set to true (Password hash strictly preserved).');
    }

    const employeeUpdate = {
      employeeId: targetEmployeeId.toUpperCase(),
      status: 'ACTIVE',
      isDeleted: false,
      deletedAt: null,
      user: existingUser._id
    };

    try {
      if (session) {
        await Employee.updateOne({ _id: existingEmployee._id }, { $set: employeeUpdate }, { session });
      } else {
        await Employee.updateOne({ _id: existingEmployee._id }, { $set: employeeUpdate });
      }
    } catch (empErr) {
      // Compensate: rollback user change if transaction is not used
      if (!useTransaction) {
        await User.updateOne(
          { _id: existingUser._id },
          { $set: { role: originalUserRole, isActive: originalUserActive } }
        );
        logger.warn('Employee update failed. Rollback applied to User record.');
      }
      throw empErr;
    }

    logger.info('Employee status set to ACTIVE, isDeleted set to false, deletedAt cleared, user linkage verified.');

    if (useTransaction && session) {
      await session.commitTransaction();
      logger.info('MongoDB transaction committed successfully.');
    }
  } catch (err) {
    if (useTransaction && session) {
      await session.abortTransaction();
      logger.error('Transaction aborted due to error during restoration.');
    }
    throw err;
  } finally {
    if (session) {
      await session.endSession();
    }
  }

  // 5. Post-Restoration Verification & Snapshot
  const restoredUser = await User.findById(existingUser._id).select('+password');
  const restoredEmployee = await Employee.findById(existingEmployee._id);

  const afterSnapshot = {
    user: {
      id: restoredUser._id.toString(),
      email: restoredUser.email,
      role: restoredUser.role,
      isActive: restoredUser.isActive,
      passwordPreserved: resetPassword ? false : (restoredUser.password === savedPasswordHash)
    },
    employee: {
      id: restoredEmployee._id.toString(),
      employeeId: restoredEmployee.employeeId,
      department: restoredEmployee.department,
      designation: restoredEmployee.designation,
      status: restoredEmployee.status,
      isDeleted: restoredEmployee.isDeleted,
      deletedAt: restoredEmployee.deletedAt,
      linkedUser: restoredEmployee.user ? restoredEmployee.user.toString() : null
    }
  };

  logger.info('--- AFTER RESTORATION SNAPSHOT ---');
  logger.info(`User: ID=${afterSnapshot.user.id}, Role=${afterSnapshot.user.role}, Active=${afterSnapshot.user.isActive}, PasswordPreserved=${afterSnapshot.user.passwordPreserved}`);
  logger.info(`Employee: ID=${afterSnapshot.employee.id}, EmpId=${afterSnapshot.employee.employeeId}, Status=${afterSnapshot.employee.status}, isDeleted=${afterSnapshot.employee.isDeleted}, deletedAt=${afterSnapshot.employee.deletedAt}`);
  logger.info('================================================================');
  logger.info('   SUPER ADMIN ACCOUNT RESTORATION COMPLETED SUCCESSFULLY       ');
  logger.info('================================================================');

  if (openedConnection) {
    await disconnectDB();
  }

  return {
    success: true,
    restored: true,
    alreadyActive: false,
    user: restoredUser,
    employee: restoredEmployee,
    before: beforeSnapshot,
    after: afterSnapshot
  };
}

/**
 * Main Super Admin Seed & Bootstrap Script
 */
const seedSuperAdmin = async () => {
  try {
    logger.info('--- Starting Super Admin Script ---');
    await connectDB();

    const adminEmail = (
      process.env.SEED_SUPER_ADMIN_EMAIL ||
      env.seedSuperAdmin?.email ||
      'lysoftware@gmail.com'
    ).trim().toLowerCase();

    const adminPassword = (
      process.env.SEED_SUPER_ADMIN_PASSWORD ||
      env.seedSuperAdmin?.password
    );

    const isRestoreRequested =
      process.argv.includes('--restore-super-admin') ||
      process.argv.includes('--restore') ||
      process.env.RESTORE_SUPER_ADMIN === 'true';

    const isResetPasswordRequested =
      process.argv.includes('--reset-password') ||
      process.env.RESET_SUPER_ADMIN_PASSWORD === 'true';

    const isForceRequested = process.argv.includes('--force');

    // ── Dedicated Restoration Mode ──
    if (isRestoreRequested) {
      logger.info('Explicit flag --restore-super-admin detected. Executing safe account restoration...');
      await restoreSuperAdminAccount({
        targetEmail: adminEmail,
        targetEmployeeId: 'SA0001',
        resetPassword: isResetPasswordRequested,
        newPassword: adminPassword
      });
      await disconnectDB();
      process.exit(0);
    }

    // ── Standard Seed Mode ──
    const existingUser = await User.findOne({ email: adminEmail });

    let superAdminUser;

    if (existingUser) {
      if (!isResetPasswordRequested && !isForceRequested) {
        if (!existingUser.isActive) {
          logger.warn(
            `Super Admin account exists with email: ${existingUser.email} (Role: ${existingUser.role}) but is currently DEACTIVATED (isActive: false).`
          );
          logger.warn(
            'To safely restore this account without altering password, run: node scripts/seedSuperAdmin.js --restore-super-admin'
          );
        } else {
          logger.info(
            `Super Admin account already exists with email: ${existingUser.email} (Role: ${existingUser.role}, Active: ${existingUser.isActive}).`
          );
        }
        logger.info(
          'Skipping seed to prevent silent overwrites. Run with --restore-super-admin to restore, or --reset-password to reset.'
        );
        await disconnectDB();
        process.exit(0);
      }

      logger.info(`Explicit update requested. Updating Super Admin account for ${adminEmail}...`);
      if (!adminPassword) {
        throw new Error('SEED_SUPER_ADMIN_PASSWORD is required in the environment to reset password.');
      }
      existingUser.password = adminPassword; // Triggers pre-save bcrypt hash
      existingUser.role = 'SUPER_ADMIN';
      existingUser.isActive = true;
      existingUser.firstName = existingUser.firstName || 'Super';
      existingUser.lastName = existingUser.lastName || 'Admin';
      await existingUser.save();
      superAdminUser = existingUser;
      logger.info(`Super Admin account (${adminEmail}) updated successfully with role SUPER_ADMIN.`);
    } else {
      if (!adminPassword) {
        throw new Error('SEED_SUPER_ADMIN_PASSWORD is required in the environment to seed the Super Admin account.');
      }
      logger.info(`Creating new Super Admin account for ${adminEmail}...`);
      superAdminUser = new User({
        firstName: 'Super',
        lastName: 'Admin',
        email: adminEmail,
        phone: '+1234567899',
        password: adminPassword, // Pre-save hook hashes with bcrypt
        role: 'SUPER_ADMIN',
        isActive: true
      });

      await superAdminUser.save();
      logger.info(`Super Admin User created successfully with email: ${adminEmail}`);
    }

    // Check or create associated Employee record for profile completeness
    const existingEmployee = await Employee.findOne({
      $or: [{ user: superAdminUser._id }, { email: adminEmail }, { employeeId: 'SA0001' }]
    });

    if (!existingEmployee) {
      const superAdminEmployee = new Employee({
        employeeId: 'SA0001',
        user: superAdminUser._id,
        firstName: superAdminUser.firstName,
        lastName: superAdminUser.lastName,
        email: adminEmail,
        phone: superAdminUser.phone || '+1234567899',
        department: 'Management',
        designation: 'Super Administrator',
        employmentType: 'FULL_TIME',
        status: 'ACTIVE',
        gender: 'OTHER'
      });

      await superAdminEmployee.save();
      logger.info('Super Admin Employee profile created with Employee ID: SA0001');
    } else {
      if (isResetPasswordRequested || isForceRequested) {
        existingEmployee.isDeleted = false;
        existingEmployee.deletedAt = null;
        existingEmployee.status = 'ACTIVE';
      }
      if (!existingEmployee.user) {
        existingEmployee.user = superAdminUser._id;
        await existingEmployee.save();
        logger.info('Linked existing Employee profile to Super Admin user.');
      } else {
        await existingEmployee.save();
        logger.info(`Employee profile already linked with Employee ID: ${existingEmployee.employeeId}`);
      }
    }

    logger.info('=== Super Admin Seed Completed Successfully ===');
    await disconnectDB();
    process.exit(0);
  } catch (error) {
    logger.error(`Error during Super Admin seeding: ${error.message}`);
    await disconnectDB();
    process.exit(1);
  }
};

if (require.main === module) {
  seedSuperAdmin();
}

module.exports = {
  seedSuperAdmin,
  restoreSuperAdminAccount
};
