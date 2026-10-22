const mongoose = require('mongoose');
const env = require('../config/env');
const { connectDB, disconnectDB } = require('../config/db');
const User = require('../models/User');
const Employee = require('../models/Employee');
const logger = require('../utils/logger');

/**
 * Idempotent Super Admin Seed Script
 * 
 * Safely creates or updates the dedicated SUPER_ADMIN account.
 * Reads email and temporary password from environment variables.
 * Never logs credentials.
 * If the user already exists, it will not overwrite credentials unless
 * explicitly invoked with --reset-password or RESET_SUPER_ADMIN_PASSWORD=true.
 */
const seedSuperAdmin = async () => {
  try {
    logger.info('--- Starting Super Admin Seed Script ---');
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

    if (!adminPassword) {
      throw new Error(
        'SEED_SUPER_ADMIN_PASSWORD is required in the environment to seed the Super Admin account.'
      );
    }

    const resetRequested =
      process.argv.includes('--reset-password') ||
      process.argv.includes('--force') ||
      process.env.RESET_SUPER_ADMIN_PASSWORD === 'true';

    // Check if account already exists by email
    const existingUser = await User.findOne({ email: adminEmail });

    let superAdminUser;

    if (existingUser) {
      if (!resetRequested) {
        logger.info(
          `Super Admin account already exists with email: ${existingUser.email} (Role: ${existingUser.role}, Active: ${existingUser.isActive}).`
        );
        logger.info(
          'Skipping seed to prevent silent overwrites. Run with --reset-password or RESET_SUPER_ADMIN_PASSWORD=true to reset.'
        );
        await disconnectDB();
        process.exit(0);
      }

      logger.info(`Explicit update requested. Updating Super Admin account for ${adminEmail}...`);
      existingUser.password = adminPassword; // Triggers pre-save bcrypt hash
      existingUser.role = 'SUPER_ADMIN';
      existingUser.isActive = true;
      existingUser.firstName = existingUser.firstName || 'Super';
      existingUser.lastName = existingUser.lastName || 'Admin';
      await existingUser.save();
      superAdminUser = existingUser;
      logger.info(`Super Admin account (${adminEmail}) updated successfully with role SUPER_ADMIN.`);
    } else {
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
      if (!existingEmployee.user) {
        existingEmployee.user = superAdminUser._id;
        await existingEmployee.save();
        logger.info('Linked existing Employee profile to Super Admin user.');
      } else {
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

module.exports = seedSuperAdmin;
