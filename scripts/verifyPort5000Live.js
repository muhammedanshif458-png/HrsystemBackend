const http = require('http');

const PORT = parseInt(process.env.PORT, 10) || 5000;

const makeRequest = (method, path, headers = {}, body = null) => {
  return new Promise((resolve, reject) => {
    let postData = null;
    const reqHeaders = { ...headers };
    if (body) {
      postData = JSON.stringify(body);
      reqHeaders['Content-Type'] = 'application/json';
      reqHeaders['Content-Length'] = Buffer.byteLength(postData);
    }

    const options = {
      hostname: '127.0.0.1',
      port: PORT,
      path,
      method,
      headers: reqHeaders
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(data);
        } catch (e) {
          parsed = data;
        }
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: parsed
        });
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
  console.log(`Testing against live server running on port ${PORT}...\n`);

  // 1. Health check
  const health = await makeRequest('GET', '/api/health');
  console.log(`[1] Health Check: HTTP ${health.statusCode} - ${health.body?.message}`);

  // 2. Login as Super Admin
  const saLogin = await makeRequest('POST', '/api/auth/login', {}, {
    email: 'lysoftware@gmail.com',
    password: 'hrAdmin'
  });
  console.log(`[2] Super Admin Login: HTTP ${saLogin.statusCode}`);
  const saToken = saLogin.body?.data?.accessToken || saLogin.body?.data?.token;

  // 3. Test GET /api/hr/daily-updates on port 5000
  const hrUpdates = await makeRequest('GET', '/api/hr/daily-updates', {
    Authorization: `Bearer ${saToken}`
  });
  console.log(`[3] GET /api/hr/daily-updates: HTTP ${hrUpdates.statusCode} - updates count: ${hrUpdates.body?.data?.length}`);

  // 4. Create dynamic staff user
  const uniqueEmail = `staff_daily_${Date.now()}@example.com`;
  const empCreate = await makeRequest('POST', '/api/hr/employees', {
    Authorization: `Bearer ${saToken}`
  }, {
    name: 'Daily Test Staff',
    email: uniqueEmail,
    phoneNumber: '9888877771',
    department: 'Engineering',
    designation: 'QA Tester',
    workMode: 'Office',
    password: 'Password123!'
  });
  console.log(`[4] Created Staff Account (${uniqueEmail}): HTTP ${empCreate.statusCode}`);

  // 5. Login as Staff
  const staffLogin = await makeRequest('POST', '/api/auth/login', {}, {
    email: uniqueEmail,
    password: 'Password123!'
  });
  console.log(`[5] Staff Login: HTTP ${staffLogin.statusCode}`);
  const staffToken = staffLogin.body?.data?.accessToken || staffLogin.body?.data?.token;

  // 6. Test POST /api/staff/daily-updates on port 5000
  const submitRes = await makeRequest('POST', '/api/staff/daily-updates', {
    Authorization: `Bearer ${staffToken}`
  }, {
    title: 'Automated Test Verification',
    updateText: 'Completed automated verification on live running server on port 5000.',
    date: '2026-10-22',
    tasksCompleted: ['Verified live port 5000', 'Tested POST and GET daily-updates'],
    blockers: 'None',
    hoursWorked: 6.5
  });
  console.log(`[6] POST /api/staff/daily-updates: HTTP ${submitRes.statusCode} - ID: ${submitRes.body?.data?.id}, Title: "${submitRes.body?.data?.title}"`);

  // 7. Test GET /api/staff/daily-updates on port 5000
  const staffList = await makeRequest('GET', '/api/staff/daily-updates', {
    Authorization: `Bearer ${staffToken}`
  });
  console.log(`[7] GET /api/staff/daily-updates: HTTP ${staffList.statusCode} - count: ${staffList.body?.data?.length}`);

  // 8. Test GET /api/hr/daily-updates with filter on port 5000
  const hrFilter = await makeRequest('GET', `/api/hr/daily-updates?employeeId=${submitRes.body?.data?.employeeId}`, {
    Authorization: `Bearer ${saToken}`
  });
  console.log(`[8] GET /api/hr/daily-updates?employeeId: HTTP ${hrFilter.statusCode} - found: ${hrFilter.body?.data?.length}`);

  if (submitRes.statusCode === 201 && staffList.statusCode === 200 && hrUpdates.statusCode === 200) {
    console.log('\n✓ ALL THREE ENDPOINTS VERIFIED ON LIVE PORT 5000 SUCCESSFULLY!');
  } else {
    throw new Error('Port 5000 verification failed!');
  }
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
