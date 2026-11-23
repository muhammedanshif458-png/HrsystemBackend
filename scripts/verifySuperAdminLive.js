const http = require('http');
const env = require('../config/env');

const makeReq = (options, postData = null) => {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(data);
        } catch {
          parsed = data;
        }
        resolve({ statusCode: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (postData) {
      req.write(postData);
    }
    req.end();
  });
};

const run = async () => {
  console.log(`--- Verifying Super Admin Live Endpoints (port ${env.port}) ---`);

  const email = process.env.SEED_SUPER_ADMIN_EMAIL || env.seedSuperAdmin?.email || 'lysoftware@gmail.com';
  const password = process.env.SEED_SUPER_ADMIN_PASSWORD || env.seedSuperAdmin?.password || 'hrAdmin';

  // 1. Invalid login test
  const badBody = JSON.stringify({ email, password: 'wrongPassword123' });
  const badRes = await makeReq({
    hostname: '127.0.0.1',
    port: env.port,
    path: '/api/auth/login',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(badBody)
    }
  }, badBody);

  if (badRes.statusCode === 401) {
    console.log('✓ Invalid credentials test PASSED (Returned HTTP 401)');
  } else {
    console.error(`✗ Invalid credentials test FAILED: Expected 401, got ${badRes.statusCode}`);
    process.exit(1);
  }

  // 2. Valid login test
  const goodBody = JSON.stringify({ email, password });
  const loginRes = await makeReq({
    hostname: '127.0.0.1',
    port: env.port,
    path: '/api/auth/login',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(goodBody)
    }
  }, goodBody);

  if (loginRes.statusCode !== 200) {
    console.error(`✗ Super Admin login FAILED: Expected 200, got ${loginRes.statusCode}`, loginRes.body);
    process.exit(1);
  }

  const role = loginRes.body?.data?.user?.role;
  const token = loginRes.body?.data?.accessToken;

  if (role === 'SUPER_ADMIN' && token) {
    console.log(`✓ Super Admin login PASSED (Returned HTTP 200, Role: ${role}, AccessToken Present)`);
  } else {
    console.error(`✗ Role verification FAILED: Expected SUPER_ADMIN, got ${role}`);
    process.exit(1);
  }

  const authHeaders = {
    'Authorization': `Bearer ${token}`
  };

  // 3. Super Admin accessing HR Dashboard
  const dashRes = await makeReq({
    hostname: '127.0.0.1',
    port: env.port,
    path: '/api/hr/dashboard',
    method: 'GET',
    headers: authHeaders
  });

  if (dashRes.statusCode === 200) {
    console.log('✓ HR Dashboard access with Super Admin token PASSED (HTTP 200)');
  } else {
    console.error(`✗ HR Dashboard access FAILED: Expected 200, got ${dashRes.statusCode}`, dashRes.body);
    process.exit(1);
  }

  // 4. Super Admin accessing HR Employees list
  const empRes = await makeReq({
    hostname: '127.0.0.1',
    port: env.port,
    path: '/api/hr/employees',
    method: 'GET',
    headers: authHeaders
  });

  if (empRes.statusCode === 200) {
    console.log('✓ HR Employees list access with Super Admin token PASSED (HTTP 200)');
  } else {
    console.error(`✗ HR Employees access FAILED: Expected 200, got ${empRes.statusCode}`, empRes.body);
    process.exit(1);
  }

  // 5. Super Admin accessing HR Departments
  const deptRes = await makeReq({
    hostname: '127.0.0.1',
    port: env.port,
    path: '/api/hr/departments',
    method: 'GET',
    headers: authHeaders
  });

  if (deptRes.statusCode === 200) {
    console.log('✓ HR Departments access with Super Admin token PASSED (HTTP 200)');
  } else {
    console.error(`✗ HR Departments access FAILED: Expected 200, got ${deptRes.statusCode}`, deptRes.body);
    process.exit(1);
  }

  // 6. Super Admin accessing Staff Dashboard (should be 403 Forbidden - role isolation)
  const staffRes = await makeReq({
    hostname: '127.0.0.1',
    port: env.port,
    path: '/api/staff/dashboard',
    method: 'GET',
    headers: authHeaders
  });

  if (staffRes.statusCode === 403) {
    console.log('✓ Role isolation PASSED: Super Admin forbidden from /api/staff/dashboard (HTTP 403)');
  } else {
    console.error(`✗ Role isolation FAILED: Expected 403, got ${staffRes.statusCode}`, staffRes.body);
    process.exit(1);
  }

  console.log('\n=== ALL LIVE SUPER ADMIN VERIFICATIONS PASSED ===\n');
  process.exit(0);
};

run().catch((e) => {
  console.error('Test execution error:', e);
  process.exit(1);
});
