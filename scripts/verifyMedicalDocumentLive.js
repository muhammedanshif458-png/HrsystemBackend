const http = require('http');
const fs = require('fs');
const path = require('path');

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
      const chunks = [];
      res.on('data', (chunk) => { chunks.push(chunk); });
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        let parsed = null;
        try {
          parsed = JSON.parse(buffer.toString('utf8'));
        } catch {
          parsed = buffer;
        }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: parsed,
          rawBuffer: buffer
        });
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
  console.log('   MEDICAL DOCUMENT FLOW & AUTH VERIFICATION TESTS     ');
  console.log('========================================================\n');

  // 1. Login as Super Admin
  console.log('[1] Logging in as Super Admin...');
  const saLogin = await request({
    method: 'POST',
    path: '/api/auth/login',
    headers: { 'Content-Type': 'application/json' },
    body: { email: 'lysoftware@gmail.com', password: 'hrAdmin' }
  });
  if (saLogin.status !== 200) throw new Error('Super Admin login failed');
  const saToken = saLogin.body?.data?.accessToken || saLogin.body?.data?.token;
  console.log('  ✓ Super Admin logged in');

  // 2. Create Staff A
  console.log('\n[2] Creating Staff A and Staff B...');
  const emailA = `staff_a_${Date.now()}@example.com`;
  const emailB = `staff_b_${Date.now()}@example.com`;

  await request({
    method: 'POST',
    path: '/api/hr/employees',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${saToken}` },
    body: {
      name: 'Alice Staff',
      email: emailA,
      phoneNumber: '9876543211',
      department: 'Tech',
      designation: 'Engineer',
      workMode: 'Office',
      password: 'Password123!'
    }
  });

  await request({
    method: 'POST',
    path: '/api/hr/employees',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${saToken}` },
    body: {
      name: 'Bob Staff',
      email: emailB,
      phoneNumber: '9876543212',
      department: 'Marketing',
      designation: 'Specialist',
      workMode: 'Remote',
      password: 'Password123!'
    }
  });

  // Login Staff A
  const loginA = await request({
    method: 'POST',
    path: '/api/auth/login',
    headers: { 'Content-Type': 'application/json' },
    body: { email: emailA, password: 'Password123!' }
  });
  const tokenA = loginA.body?.data?.accessToken || loginA.body?.data?.token;

  // Login Staff B
  const loginB = await request({
    method: 'POST',
    path: '/api/auth/login',
    headers: { 'Content-Type': 'application/json' },
    body: { email: emailB, password: 'Password123!' }
  });
  const tokenB = loginB.body?.data?.accessToken || loginB.body?.data?.token;
  console.log('  ✓ Staff A & Staff B created and logged in');

  // 3. Staff A uploads a Medical Leave with PDF attachment
  console.log('\n[3] Staff A submits Medical Leave with certificate PDF...');
  const testPdfContent = '%PDF-1.5 Medical Certificate for Alice. Verified by Dr. Smith. %EOF';
  const mp = buildMultipartFormData(
    {
      leaveType: 'Medical Leave',
      startDate: '2026-11-10',
      endDate: '2026-11-12',
      reason: 'Fever and viral infection'
    },
    {
      name: 'medicalProof',
      filename: 'alice_cert.pdf',
      contentType: 'application/pdf',
      data: Buffer.from(testPdfContent)
    }
  );

  const applyRes = await request({
    method: 'POST',
    path: '/api/staff/leaves',
    headers: { 'Authorization': `Bearer ${tokenA}`, ...mp.headers },
    body: mp.payload
  });

  if (applyRes.status !== 201) {
    console.error('Failed to apply leave:', applyRes.body);
    throw new Error('Leave apply failed');
  }

  const createdLeave = applyRes.body.data;
  const docId = createdLeave.document;
  const rawFilePath = createdLeave.attachment?.filePath;
  console.log('  ✓ Leave created: ID =', createdLeave._id);
  console.log('    docId =', docId);
  console.log('    documentUrl =', createdLeave.documentUrl);
  console.log('    hasMedicalProof =', createdLeave.hasMedicalProof);
  console.log('    medicalProofUrl =', createdLeave.medicalProofUrl);
  console.log('    rawFilePath =', rawFilePath);

  // 4. Test Direct Static Access to /uploads/documents/ (must be 403 Forbidden)
  console.log('\n[4] Testing direct static unauthenticated access to /uploads/documents/...');
  const directRes = await request({
    method: 'GET',
    path: rawFilePath
  });
  if (directRes.status === 403) {
    console.log('  ✓ Direct unauthenticated access blocked with HTTP 403 Forbidden!');
  } else {
    console.error(`  ✗ Expected 403 Forbidden, but received HTTP ${directRes.status}`);
    process.exit(1);
  }

  // 5. Staff A downloads/previews own document via /api/staff/documents/:docId/download
  console.log('\n[5] Staff A downloading/previewing own document via Staff API...');
  const staffDownload = await request({
    method: 'GET',
    path: `/api/staff/documents/${docId}/download`,
    headers: { 'Authorization': `Bearer ${tokenA}` }
  });

  if (staffDownload.status === 200) {
    const receivedText = staffDownload.rawBuffer.toString('utf8');
    if (receivedText === testPdfContent) {
      console.log('  ✓ Document fetched successfully (HTTP 200) and content matches byte-for-byte!');
    } else {
      console.error('  ✗ Content mismatch:', receivedText);
      process.exit(1);
    }
    console.log('    Content-Type:', staffDownload.headers['content-type']);
    console.log('    Content-Disposition:', staffDownload.headers['content-disposition']);
  } else {
    console.error('  ✗ Staff download failed with status:', staffDownload.status, staffDownload.body);
    process.exit(1);
  }

  // 6. Test Download flag (?download=true)
  console.log('\n[6] Testing attachment Content-Disposition with ?download=true...');
  const forceDownload = await request({
    method: 'GET',
    path: `/api/staff/documents/${docId}/download?download=true`,
    headers: { 'Authorization': `Bearer ${tokenA}` }
  });
  if (forceDownload.status === 200 && forceDownload.headers['content-disposition']?.startsWith('attachment;')) {
    console.log('  ✓ Content-Disposition is attachment:', forceDownload.headers['content-disposition']);
  } else {
    console.error('  ✗ Expected attachment header, got:', forceDownload.headers['content-disposition']);
    process.exit(1);
  }

  // 7. Authorization check: Staff B cannot access Staff A's document
  console.log('\n[7] Testing authorization: Staff B attempting to access Staff A document...');
  const unauthorizedStaff = await request({
    method: 'GET',
    path: `/api/staff/documents/${docId}/download`,
    headers: { 'Authorization': `Bearer ${tokenB}` }
  });
  if (unauthorizedStaff.status === 403) {
    console.log('  ✓ Staff B blocked with HTTP 403 Forbidden:', unauthorizedStaff.body.message);
  } else {
    console.error(`  ✗ Expected 403 Forbidden for Staff B, got ${unauthorizedStaff.status}`);
    process.exit(1);
  }

  // 8. Authorization check: Unauthenticated access to API download endpoint
  console.log('\n[8] Testing unauthenticated access to /api/staff/documents/:docId/download...');
  const noAuth = await request({
    method: 'GET',
    path: `/api/staff/documents/${docId}/download`
  });
  if (noAuth.status === 401) {
    console.log('  ✓ Unauthenticated access blocked with HTTP 401 Unauthorized');
  } else {
    console.error(`  ✗ Expected 401 Unauthorized, got ${noAuth.status}`);
    process.exit(1);
  }

  // 9. HR / Super Admin downloads document via /api/hr/documents/:docId/download
  console.log('\n[9] HR / Super Admin downloading document via HR API...');
  const hrDownload = await request({
    method: 'GET',
    path: `/api/hr/documents/${docId}/download`,
    headers: { 'Authorization': `Bearer ${saToken}` }
  });
  if (hrDownload.status === 200) {
    const receivedText = hrDownload.rawBuffer.toString('utf8');
    if (receivedText === testPdfContent) {
      console.log('  ✓ HR downloaded document successfully (HTTP 200) with identical content!');
    } else {
      console.error('  ✗ HR downloaded content mismatch');
      process.exit(1);
    }
  } else {
    console.error('  ✗ HR download failed with status:', hrDownload.status, hrDownload.body);
    process.exit(1);
  }

  // 10. Staff attempting to call HR document endpoint
  console.log('\n[10] Testing Staff attempting to access HR document endpoint...');
  const staffOnHrEndpoint = await request({
    method: 'GET',
    path: `/api/hr/documents/${docId}/download`,
    headers: { 'Authorization': `Bearer ${tokenA}` }
  });
  if (staffOnHrEndpoint.status === 403) {
    console.log('  ✓ Staff correctly rejected with HTTP 403 Forbidden from HR endpoint');
  } else {
    console.error(`  ✗ Expected 403, got ${staffOnHrEndpoint.status}`);
    process.exit(1);
  }

  // 11. Verify HR Leaves listing returns enriched document metadata
  console.log('\n[11] Verifying HR Leaves listing (GET /api/hr/leaves) returns enriched metadata...');
  const hrLeavesRes = await request({
    method: 'GET',
    path: '/api/hr/leaves',
    headers: { 'Authorization': `Bearer ${saToken}` }
  });
  if (hrLeavesRes.status === 200) {
    const leaves = hrLeavesRes.body?.data?.leaves || hrLeavesRes.body?.data;
    const leaveWithMed = Array.isArray(leaves) ? leaves.find(l => l._id === createdLeave._id) : null;
    if (leaveWithMed) {
      console.log('  ✓ Found created leave in HR list:');
      console.log('    hasMedicalProof:', leaveWithMed.hasMedicalProof);
      console.log('    medicalProofUrl:', leaveWithMed.medicalProofUrl);
      console.log('    medicalProofFileName:', leaveWithMed.medicalProofFileName);
      console.log('    medicalProofFileType:', leaveWithMed.medicalProofFileType);
      console.log('    documentUrl:', leaveWithMed.documentUrl);
      if (leaveWithMed.hasMedicalProof && leaveWithMed.medicalProofUrl.includes('/api/hr/documents/')) {
        console.log('  ✓ HR medical proof fields are properly formatted and populated!');
      } else {
        console.error('  ✗ HR medical proof fields incomplete:', leaveWithMed);
        process.exit(1);
      }
    } else {
      console.error('  ✗ Created leave not found in HR list');
      process.exit(1);
    }
  } else {
    console.error('  ✗ GET /api/hr/leaves failed:', hrLeavesRes.status, hrLeavesRes.body);
    process.exit(1);
  }

  // 12. Verify Staff Leaves listing returns enriched document metadata
  console.log('\n[12] Verifying Staff Leaves listing (GET /api/staff/leaves) returns enriched metadata...');
  const staffLeavesRes = await request({
    method: 'GET',
    path: '/api/staff/leaves',
    headers: { 'Authorization': `Bearer ${tokenA}` }
  });
  if (staffLeavesRes.status === 200) {
    const leaves = staffLeavesRes.body?.data;
    const leaveItem = Array.isArray(leaves) ? leaves.find(l => l._id === createdLeave._id) : null;
    if (leaveItem) {
      console.log('  ✓ Found created leave in Staff list:');
      console.log('    hasMedicalProof:', leaveItem.hasMedicalProof);
      console.log('    medicalProofUrl:', leaveItem.medicalProofUrl);
      console.log('    medicalProofFileName:', leaveItem.medicalProofFileName);
      console.log('    documentUrl:', leaveItem.documentUrl);
      if (leaveItem.documentUrl.includes('/api/staff/documents/')) {
        console.log('  ✓ Staff documentUrl points to authenticated staff download endpoint!');
      } else {
        console.error('  ✗ Staff documentUrl is not authenticated endpoint:', leaveItem.documentUrl);
        process.exit(1);
      }
    } else {
      console.error('  ✗ Created leave not found in Staff list');
      process.exit(1);
    }
  }

  console.log('\n========================================================');
  console.log('   ALL MEDICAL DOCUMENT FLOW TESTS PASSED! (12/12)     ');
  console.log('========================================================\n');
}

run().catch((err) => {
  console.error('Verification failed with error:', err);
  process.exit(1);
});
