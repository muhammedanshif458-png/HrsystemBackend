const http = require('http');
const fs = require('fs');
const path = require('path');

// Helper to make HTTP requests
function request({ method, path: reqPath, headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: '127.0.0.1',
      port: 5000,
      path: reqPath,
      method,
      headers: { ...headers }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(data);
        } catch {
          parsed = data;
        }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });

    req.on('error', reject);

    if (body) {
      if (Buffer.isBuffer(body) || typeof body === 'string') {
        req.write(body);
      } else {
        req.write(JSON.stringify(body));
      }
    }
    req.end();
  });
}

function buildMultipartFormData(fields, fileField) {
  const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
  const crlf = '\r\n';
  const chunks = [];

  for (const [key, value] of Object.entries(fields)) {
    chunks.push(Buffer.from(
      `--${boundary}${crlf}` +
      `Content-Disposition: form-data; name="${key}"${crlf}${crlf}` +
      `${value}${crlf}`
    ));
  }

  if (fileField) {
    chunks.push(Buffer.from(
      `--${boundary}${crlf}` +
      `Content-Disposition: form-data; name="${fileField.name}"; filename="${fileField.filename}"${crlf}` +
      `Content-Type: ${fileField.contentType || 'application/octet-stream'}${crlf}${crlf}`
    ));
    chunks.push(Buffer.isBuffer(fileField.data) ? fileField.data : Buffer.from(fileField.data));
    chunks.push(Buffer.from(crlf));
  }

  chunks.push(Buffer.from(`--${boundary}--${crlf}`));

  const payload = Buffer.concat(chunks);
  return {
    boundary,
    payload,
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': payload.length
    }
  };
}

async function run() {
  console.log('========================================================');
  console.log('   LIVE LEAVE API VALIDATION & MULTIPART VERIFICATION   ');
  console.log('========================================================\n');

  // 1. Login as staff or Super Admin
  console.log('[1] Logging in as Super Admin (lysoftware@gmail.com)...');
  const saLogin = await request({
    method: 'POST',
    path: '/api/auth/login',
    headers: { 'Content-Type': 'application/json' },
    body: { email: 'lysoftware@gmail.com', password: 'hrAdmin' }
  });

  if (saLogin.status !== 200) {
    console.error('  ✗ Super Admin login failed:', saLogin.body);
    process.exit(1);
  }
  const saToken = saLogin.body?.data?.accessToken || saLogin.body?.data?.token;
  console.log('  ✓ Super Admin logged in (HTTP 200)');

  // Create staff member
  const uniqueEmail = `staff_${Date.now()}@example.com`;
  const createStaffRes = await request({
    method: 'POST',
    path: '/api/hr/employees',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${saToken}` },
    body: {
      name: 'Leave Test Staff',
      email: uniqueEmail,
      phoneNumber: '9876543210',
      department: 'Tech',
      designation: 'Developer',
      workMode: 'Office',
      password: 'Password123!'
    }
  });

  if (createStaffRes.status !== 201) {
    console.error('  ✗ Failed to create staff account:', createStaffRes.body);
    process.exit(1);
  }
  console.log('  ✓ Created new staff account:', uniqueEmail);

  // Login as staff
  const staffLogin = await request({
    method: 'POST',
    path: '/api/auth/login',
    headers: { 'Content-Type': 'application/json' },
    body: { email: uniqueEmail, password: 'Password123!' }
  });

  if (staffLogin.status !== 200) {
    console.error('  ✗ Staff login failed:', staffLogin.body);
    process.exit(1);
  }
  const staffToken = staffLogin.body?.data?.accessToken || staffLogin.body?.data?.token;
  console.log('  ✓ Staff login successful with created account');

  const authHeader = { 'Authorization': `Bearer ${staffToken}` };

  // 2. Test JSON Leave Types
  console.log('\n[2] Testing Flutter UI Leave Type aliases (JSON)...');
  const typeTests = [
    { type: 'Casual Leave', start: '2026-11-01', end: '2026-11-02', reason: 'Family gathering' },
    { type: 'Sick Leave', start: '2026-11-05', end: '2026-11-06', reason: 'Seasonal fever' },
    { type: 'Medical Leave', start: '2026-11-10', end: '2026-11-12', reason: 'Hospital consultation' },
    { type: 'Earned Leave', start: '2026-11-15', end: '2026-11-17', reason: 'Annual vacation trip' },
  ];

  for (const t of typeTests) {
    const res = await request({
      method: 'POST',
      path: '/api/staff/leaves',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: {
        leaveType: t.type,
        startDate: t.start,
        endDate: t.end,
        reason: t.reason
      }
    });

    if (res.status === 201) {
      console.log(`  ✓ Submitting "${t.type}" succeeded (Status: ${res.status}) -> Stored canonical type: "${res.body.data.leaveType}"`);
    } else {
      console.error(`  ✗ Submitting "${t.type}" failed with ${res.status}:`, res.body);
      process.exit(1);
    }
  }

  // 3. Test Multipart/Form-Data File Upload (Medical Certificate)
  console.log('\n[3] Testing Multipart/Form-Data File Upload (field: medicalProof)...');
  const dummyPdfContent = Buffer.from('%PDF-1.4\n%DUMMY MEDICAL CERTIFICATE FOR TESTING\n%%EOF');
  const mp1 = buildMultipartFormData(
    {
      leaveType: 'Medical Leave',
      startDate: '2026-11-20',
      endDate: '2026-11-22',
      reason: 'Surgery follow-up recovery'
    },
    {
      name: 'medicalProof',
      filename: 'medical_report_2026.pdf',
      contentType: 'application/pdf',
      data: dummyPdfContent
    }
  );

  const mpRes1 = await request({
    method: 'POST',
    path: '/api/staff/leaves',
    headers: { ...authHeader, ...mp1.headers },
    body: mp1.payload
  });

  if (mpRes1.status === 201) {
    const leave = mpRes1.body.data;
    console.log('  ✓ Multipart leave creation succeeded (Status 201)!');
    console.log('    Leave ID:', leave._id);
    console.log('    Leave Type:', leave.leaveType);
    console.log('    Document ID:', leave.document);
    console.log('    Document URL:', leave.documentUrl);
    console.log('    Document Name:', leave.documentName);
    console.log('    Attachment Metadata:', leave.attachment);

    // Verify file exists on server disk
    if (leave.attachment && leave.attachment.filePath) {
      const relativePart = leave.attachment.filePath.replace(/^\/+/, '');
      const diskPath = path.resolve(__dirname, '..', relativePart);
      if (fs.existsSync(diskPath)) {
        console.log(`  ✓ File verified on server filesystem: ${diskPath}`);
      } else {
        console.error(`  ✗ File NOT found on filesystem: ${diskPath}`);
        process.exit(1);
      }
    }
  } else {
    console.error('  ✗ Multipart file upload failed with status:', mpRes1.status, mpRes1.body);
    process.exit(1);
  }

  // 4. Test Multipart with alternative field name (file)
  console.log('\n[4] Testing Multipart/Form-Data with field name "file"...');
  const mp2 = buildMultipartFormData(
    {
      leaveType: 'MEDICAL',
      startDate: '2026-11-25',
      endDate: '2026-11-26',
      reason: 'Dental surgery documentation'
    },
    {
      name: 'file',
      filename: 'dental_proof.png',
      contentType: 'image/png',
      data: Buffer.from('89504e470d0a1a0a', 'hex')
    }
  );

  const mpRes2 = await request({
    method: 'POST',
    path: '/api/staff/leaves',
    headers: { ...authHeader, ...mp2.headers },
    body: mp2.payload
  });

  if (mpRes2.status === 201) {
    console.log('  ✓ File field "file" accepted and linked (Status 201):', mpRes2.body.data.documentName);
  } else {
    console.error('  ✗ Field "file" upload failed:', mpRes2.body);
    process.exit(1);
  }

  // 5. Test fromDate / toDate field aliases (JSON)
  console.log('\n[5] Testing fromDate and toDate field aliases...');
  const aliasRes = await request({
    method: 'POST',
    path: '/api/staff/leaves',
    headers: { ...authHeader, 'Content-Type': 'application/json' },
    body: {
      leaveType: 'CASUAL',
      fromDate: '2026-12-01',
      toDate: '2026-12-02',
      reason: 'Personal travel'
    }
  });

  if (aliasRes.status === 201) {
    console.log('  ✓ fromDate/toDate aliases properly normalized and saved (Status 201)');
  } else {
    console.error('  ✗ fromDate/toDate alias failed:', aliasRes.body);
    process.exit(1);
  }

  // 6. Test GET /api/staff/leaves populates documents
  console.log('\n[6] Testing GET /api/staff/leaves (document population)...');
  const listRes = await request({
    method: 'GET',
    path: '/api/staff/leaves',
    headers: { ...authHeader }
  });

  if (listRes.status === 200 && Array.isArray(listRes.body.data)) {
    const leavesWithDoc = listRes.body.data.filter(l => l.document);
    console.log(`  ✓ Retrieved ${listRes.body.data.length} leave requests (${leavesWithDoc.length} with document populated).`);
    const sample = leavesWithDoc[0];
    if (sample && typeof sample.document === 'object') {
      console.log('  ✓ Document populated as object:', {
        id: sample.document._id,
        category: sample.document.category,
        title: sample.document.title,
        fileUrl: sample.document.fileUrl
      });
    }
  } else {
    console.error('  ✗ GET /api/staff/leaves failed:', listRes.body);
    process.exit(1);
  }

  // 7. Test Validation Failures (422)
  console.log('\n[7] Testing Validation Failures (422)...');

  // Case A: Invalid leave type
  const badTypeRes = await request({
    method: 'POST',
    path: '/api/staff/leaves',
    headers: { ...authHeader, 'Content-Type': 'application/json' },
    body: {
      leaveType: 'Festival Vacation',
      startDate: '2026-12-10',
      endDate: '2026-12-11',
      reason: 'Celebrating festival'
    }
  });
  if (badTypeRes.status === 422) {
    console.log('  ✓ Invalid leave type rejected with 422:', badTypeRes.body.errors[0]?.message);
  } else {
    console.error('  ✗ Expected 422 for bad type, got:', badTypeRes.status);
    process.exit(1);
  }

  // Case B: End date before start date
  const badDateRes = await request({
    method: 'POST',
    path: '/api/staff/leaves',
    headers: { ...authHeader, 'Content-Type': 'application/json' },
    body: {
      leaveType: 'CASUAL',
      startDate: '2026-12-20',
      endDate: '2026-12-18',
      reason: 'Time travel'
    }
  });
  if (badDateRes.status === 422) {
    console.log('  ✓ End date before start date rejected with 422:', badDateRes.body.errors[0]?.message);
  } else {
    console.error('  ✗ Expected 422 for end < start, got:', badDateRes.status);
    process.exit(1);
  }

  // Case C: Empty reason
  const emptyReasonRes = await request({
    method: 'POST',
    path: '/api/staff/leaves',
    headers: { ...authHeader, 'Content-Type': 'application/json' },
    body: {
      leaveType: 'CASUAL',
      startDate: '2026-12-22',
      endDate: '2026-12-23',
      reason: '   '
    }
  });
  if (emptyReasonRes.status === 422) {
    console.log('  ✓ Empty reason rejected with 422:', emptyReasonRes.body.errors[0]?.message);
  } else {
    console.error('  ✗ Expected 422 for empty reason, got:', emptyReasonRes.status);
    process.exit(1);
  }

  // Case D: Local client path in documentUrl rejected
  const localDocRes = await request({
    method: 'POST',
    path: '/api/staff/leaves',
    headers: { ...authHeader, 'Content-Type': 'application/json' },
    body: {
      leaveType: 'CASUAL',
      startDate: '2026-12-25',
      endDate: '2026-12-26',
      reason: 'Holiday leave',
      documentUrl: 'C:\\Users\\Admin\\AppData\\Local\\Temp\\report.pdf'
    }
  });
  if (localDocRes.status === 422) {
    console.log('  ✓ Local client file path rejected with 422:', localDocRes.body.errors[0]?.message);
  } else {
    console.error('  ✗ Expected 422 for local path documentUrl, got:', localDocRes.status);
    process.exit(1);
  }

  // 8. Test 401 Unauthorized
  console.log('\n[8] Testing Unauthenticated request (401)...');
  const unauthRes = await request({
    method: 'POST',
    path: '/api/staff/leaves',
    headers: { 'Content-Type': 'application/json' },
    body: {
      leaveType: 'CASUAL',
      startDate: '2026-12-28',
      endDate: '2026-12-29',
      reason: 'Unauthorized test'
    }
  });
  if (unauthRes.status === 401) {
    console.log('  ✓ Unauthenticated request rejected with 401.');
  } else {
    console.error('  ✗ Expected 401, got:', unauthRes.status);
    process.exit(1);
  }

  console.log('\n========================================================');
  console.log('   ALL LIVE LEAVE & ATTACHMENT TESTS PASSED! (8/8)     ');
  console.log('========================================================\n');
}

run().catch((err) => {
  console.error('Test script error:', err);
  process.exit(1);
});
