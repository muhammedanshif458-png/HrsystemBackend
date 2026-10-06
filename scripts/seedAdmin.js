const mongoose = require('mongoose');
const env = require('../config/env');
const { connectDB, disconnectDB } = require('../config/db');
const User = require('../models/User');
const Employee = require('../models/Employee');
const logger = require('../utils/logger');

const seedAdmin = async () => {
  try {
    logger.info('--- Starting HR Admin Seed Script ---');
    await connectDB();

    const adminEmail = (env.seedAdmin.email || 'admin@hrmanagement.com').toLowerCase();
    const adminPassword = env.seedAdmin.password || 'Admin@12345';

    // Check if any HR account or an account with this email already exists
    const existingAdmin = await User.findOne({
      $or: [{ email: adminEmail }, { role: 'HR' }]
    });

    if (existingAdmin) {
      logger.info(`HR account already exists with email: ${existingAdmin.email} (Role: ${existingAdmin.role}). Skipping seed.`);
      await disconnectDB();
      process.exit(0);
    }

    // Create the HR User (pre-save hook will hash the password)
    const adminUser = new User({
      firstName: 'System',
      lastName: 'Administrator',
      email: adminEmail,
      phone: '+1234567890',
      password: adminPassword,
      role: 'HR',
      isActive: true
    });

    await adminUser.save();
    logger.info(`HR User created successfully with email: ${adminEmail}`);

    // Create corresponding Employee record for HR
    const adminEmployee = new Employee({
      employeeId: 'HR0001',
      user: adminUser._id,
      firstName: 'System',
      lastName: 'Administrator',
      email: adminEmail,
      phone: '+1234567890',
      department: 'Human Resources',
      designation: 'HR Director',
      employmentType: 'FULL_TIME',
      status: 'ACTIVE',
      gender: 'OTHER'
    });

    await adminEmployee.save();
    logger.info(`HR Employee profile created with Employee ID: HR0001`);

    logger.info('=== HR Admin Seed Completed Successfully ===');
    await disconnectDB();
    process.exit(0);
  } catch (error) {
    logger.error(`Error during HR seeding: ${error.message}`, error);
    await disconnectDB();
    process.exit(1);
  }
};

seedAdmin();
