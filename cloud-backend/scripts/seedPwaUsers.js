const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../src/models/User');
const config = require('../src/config');

async function seed() {
  await mongoose.connect(config.mongoUri);
  console.log('[seeder] Connected to MongoDB');

  const users = [
    {
      email: 'owner@test.com',
      password: 'password123',
      role: 'owner',
      gymId: 'TEST_GYM_01',
      phone: '9876543210',
      displayName: 'PowerHouse Owner',
      isPrimaryOwner: true
    },
    {
      email: 'trainer@test.com',
      password: 'password123',
      role: 'trainer',
      gymId: 'TEST_GYM_01',
      trainerId: 1,
      phone: '9876543211',
      displayName: 'Trainer One'
    },
    {
      email: 'client@test.com',
      password: 'password123',
      role: 'client',
      gymId: 'TEST_GYM_01',
      memberId: 1,
      phone: '9876543212',
      displayName: 'Client One'
    }
  ];

  for (const u of users) {
    const existing = await User.findOne({ email: u.email });
    if (existing) {
      existing.phone = u.phone;
      existing.displayName = u.displayName;
      existing.isPrimaryOwner = Boolean(u.isPrimaryOwner);
      if (u.trainerId) existing.trainerId = u.trainerId;
      if (u.memberId) existing.memberId = u.memberId;
      await existing.save();
      console.log(`[seeder] User ${u.email} already exists. Updated profile fields.`);
      continue;
    }

    const passwordHash = await bcrypt.hash(u.password, 10);
    
    const newUser = new User({
      email: u.email,
      passwordHash,
      role: u.role,
      gymId: u.gymId,
      trainerId: u.trainerId,
      memberId: u.memberId,
      phone: u.phone,
      displayName: u.displayName,
      isPrimaryOwner: Boolean(u.isPrimaryOwner)
    });

    await newUser.save();
    console.log(`[seeder] Successfully created user: ${u.email} (Role: ${u.role})`);
  }

  await mongoose.disconnect();
  console.log('[seeder] Disconnected from MongoDB');
}

seed().catch((err) => {
  console.error('[seeder] Error:', err);
  process.exit(1);
});
