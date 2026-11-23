const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const PORT = parseInt(process.env.PORT, 10) || 5000;

function request({ method, path: reqPath, headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: '127.0.0.1',
      port: PORT,
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
  console.log('================================================================');
  console.log('   HR MEDICAL DOCUMENT RETRIEVAL & RENDERING VERIFICATION SUITE');
  console.log('================================================================\n');

  // Step 1: Login as Super Admin (HR Role)
  console.log('[1] Authenticating as Super Admin / HR (lysoftware@gmail.com)...');
  const saLogin = await request({
    method: 'POST',
    path: '/api/auth/login',
    headers: { 'Content-Type': 'application/json' },
    body: { email: 'lysoftware@gmail.com', password: 'hrAdmin' }
  });
  assert.strictEqual(saLogin.status, 200, 'Super Admin login failed');
  const hrToken = saLogin.body?.data?.accessToken || saLogin.body?.data?.token;
  console.log('  ✓ Authenticated as HR/Super Admin');

  // Step 2: Create two dynamic staff members for tenant isolation testing
  console.log('\n[2] Setting up Staff Member A & Staff Member B...');
  const emailA = `doctor_patient_${Date.now()}@example.com`;
  const emailB = `other_staff_${Date.now()}@example.com`;

  await request({
    method: 'POST',
    path: '/api/hr/employees',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${hrToken}` },
    body: {
      name: 'John Patient',
      email: emailA,
      phoneNumber: '9123456780',
      department: 'Tech',
      designation: 'Backend Developer',
      workMode: 'Office',
      password: 'Password123!'
    }
  });

  await request({
    method: 'POST',
    path: '/api/hr/employees',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${hrToken}` },
    body: {
      name: 'Jane Colleague',
      email: emailB,
      phoneNumber: '9123456781',
      department: 'Marketing',
      designation: 'Content Writer',
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
  console.log('  ✓ Created and authenticated Staff A & Staff B');

  // Step 3: Staff A uploads a real test PDF via Medical Leave request
  console.log('\n[3] Staff A submits Medical Leave with real PDF bytes...');
  // Valid PDF header and structure
  const realPdfBytes = Buffer.from(
    '%PDF-1.5\n' +
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' +
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n' +
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>\nendobj\n' +
    '4 0 obj\n<< /Length 55 >>\nstream\nBT /F1 12 Tf 100 700 Td (Medical Certificate - Acute Flu) Tj ET\nendstream\nendobj\n' +
    'xref\n0 5\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n0000000206 00000 n \n' +
    'trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n312\n%%EOF'
  );

  const multipart = buildMultipartFormData(
    {
      leaveType: 'Medical Leave',
      startDate: '2026-11-15',
      endDate: '2026-11-18',
      reason: 'Diagnosed with acute viral fever, bed rest advised by physician'
    },
    {
      name: 'medicalProof',
      filename: 'official_medical_certificate.pdf',
      contentType: 'application/pdf',
      data: realPdfBytes
    }
  );

  const applyRes = await request({
    method: 'POST',
    path: '/api/staff/leaves',
    headers: { 'Authorization': `Bearer ${tokenA}`, ...multipart.headers },
    body: multipart.payload
  });

  assert.strictEqual(applyRes.status, 201, `Leave application failed: ${JSON.stringify(applyRes.body)}`);
  const createdLeave = applyRes.body.data;
  const docId = createdLeave.documentId || createdLeave.document;
  console.log('  ✓ Medical Leave created:');
  console.log('    Leave ID:', createdLeave._id);
  console.log('    Document ID:', docId);
  console.log('    hasMedicalProof:', createdLeave.hasMedicalProof);
  console.log('    medicalProofUrl:', createdLeave.medicalProofUrl);
  console.log('    medicalProofFileType:', createdLeave.medicalProofFileType);
  console.log('    medicalProofFileName:', createdLeave.medicalProofFileName);

  assert.ok(docId, 'Document ID must be present');
  assert.strictEqual(createdLeave.hasMedicalProof, true, 'hasMedicalProof must be true');
  assert.ok(!createdLeave.medicalProofUrl.includes('C:'), 'medicalProofUrl must not expose filesystem paths');
  assert.ok(!createdLeave.medicalProofUrl.includes('\\'), 'medicalProofUrl must not have Windows backslashes');

  // Step 4: HR retrieves leave record and verifies enriched metadata
  console.log('\n[4] HR retrieves Leave record via GET /api/hr/leaves/:id...');
  const hrLeaveRes = await request({
    method: 'GET',
    path: `/api/hr/leaves/${createdLeave._id}`,
    headers: { 'Authorization': `Bearer ${hrToken}` }
  });

  assert.strictEqual(hrLeaveRes.status, 200, 'HR leave retrieval failed');
  const hrLeaveData = hrLeaveRes.body.data;
  console.log('  ✓ HR received enriched leave record:');
  console.log('    hasMedicalProof:', hrLeaveData.hasMedicalProof);
  console.log('    medicalProofUrl:', hrLeaveData.medicalProofUrl);
  console.log('    medicalProofFileName:', hrLeaveData.medicalProofFileName);
  console.log('    medicalProofFileType:', hrLeaveData.medicalProofFileType);
  console.log('    documentUrl:', hrLeaveData.documentUrl);

  assert.strictEqual(hrLeaveData.hasMedicalProof, true);
  assert.strictEqual(hrLeaveData.medicalProofFileType, 'application/pdf');
  assert.strictEqual(hrLeaveData.medicalProofFileName, 'official_medical_certificate.pdf');
  assert.strictEqual(hrLeaveData.medicalProofUrl, `/api/hr/documents/${docId}/download`);
  assert.strictEqual(hrLeaveData.documentUrl, `/api/hr/documents/${docId}/download`);

  // Step 5: HR retrieves the document via GET /api/hr/documents/:docId/download
  console.log('\n[5] HR requests document download (inline preview)...');
  const hrDocRes = await request({
    method: 'GET',
    path: `/api/hr/documents/${docId}/download`,
    headers: { 'Authorization': `Bearer ${hrToken}` }
  });

  console.log('  HTTP Status:', hrDocRes.status);
  console.log('  Content-Type:', hrDocRes.headers['content-type']);
  console.log('  Content-Disposition:', hrDocRes.headers['content-disposition']);
  console.log('  Cross-Origin-Resource-Policy:', hrDocRes.headers['cross-origin-resource-policy']);
  console.log('  Access-Control-Expose-Headers:', hrDocRes.headers['access-control-expose-headers']);
  console.log('  Bytes Received:', hrDocRes.rawBuffer.length);

  assert.strictEqual(hrDocRes.status, 200, 'Expected HTTP 200');
  assert.ok(hrDocRes.headers['content-type'].includes('application/pdf'), 'Content-Type must be application/pdf');
  assert.ok(hrDocRes.headers['content-disposition'].startsWith('inline;'), 'Content-Disposition must be inline for preview');
  assert.ok(hrDocRes.headers['content-disposition'].includes('official_medical_certificate.pdf'), 'Content-Disposition must have filename');

  // Verify PDF file signature (%PDF-)
  const pdfMagic = hrDocRes.rawBuffer.slice(0, 5).toString('ascii');
  console.log('  PDF Magic Bytes Signature:', pdfMagic);
  assert.strictEqual(pdfMagic, '%PDF-', 'File signature must be %PDF-');

  // Verify byte-for-byte fidelity
  assert.deepStrictEqual(hrDocRes.rawBuffer, realPdfBytes, 'Downloaded bytes must match uploaded PDF byte-for-byte');
  console.log('  ✓ PDF binary stream verified with 100% byte-for-byte match!');

  // Step 6: Test ?download=true forces attachment disposition
  console.log('\n[6] Testing ?download=true flag...');
  const forceDlRes = await request({
    method: 'GET',
    path: `/api/hr/documents/${docId}/download?download=true`,
    headers: { 'Authorization': `Bearer ${hrToken}` }
  });
  assert.strictEqual(forceDlRes.status, 200);
  assert.ok(forceDlRes.headers['content-disposition'].startsWith('attachment;'), 'Must be attachment disposition');
  console.log('  ✓ ?download=true correctly sets Content-Disposition: attachment');

  // Step 7: Test Error Cases
  console.log('\n[7] Testing Error Handling & Missing Document Handling...');

  // A. Invalid ObjectId format
  const badIdRes = await request({
    method: 'GET',
    path: '/api/hr/documents/invalid-mongo-id/download',
    headers: { 'Authorization': `Bearer ${hrToken}` }
  });
  console.log('  Invalid ID Status:', badIdRes.status, badIdRes.body?.message);
  assert.strictEqual(badIdRes.status, 400);

  // B. Non-existent Document ObjectId
  const missingDocRes = await request({
    method: 'GET',
    path: '/api/hr/documents/6ad000000000000000000000/download',
    headers: { 'Authorization': `Bearer ${hrToken}` }
  });
  console.log('  Non-existent Document Status:', missingDocRes.status, missingDocRes.body?.message);
  assert.strictEqual(missingDocRes.status, 404);

  // C. Unauthenticated access to document endpoint
  const unauthRes = await request({
    method: 'GET',
    path: `/api/hr/documents/${docId}/download`
  });
  console.log('  Unauthenticated Status:', unauthRes.status);
  assert.strictEqual(unauthRes.status, 401);

  // D. Staff attempting to call HR document endpoint
  const staffOnHrRes = await request({
    method: 'GET',
    path: `/api/hr/documents/${docId}/download`,
    headers: { 'Authorization': `Bearer ${tokenA}` }
  });
  console.log('  Staff on HR endpoint Status:', staffOnHrRes.status);
  assert.strictEqual(staffOnHrRes.status, 403);

  // E. Cross-staff access isolation (Staff B attempting to download Staff A's document)
  const crossStaffRes = await request({
    method: 'GET',
    path: `/api/staff/documents/${docId}/download`,
    headers: { 'Authorization': `Bearer ${tokenB}` }
  });
  console.log('  Cross-staff unauthorized Status:', crossStaffRes.status, crossStaffRes.body?.message);
  assert.strictEqual(crossStaffRes.status, 403);

  // F. Staff A downloading own document via Staff endpoint
  const ownStaffRes = await request({
    method: 'GET',
    path: `/api/staff/documents/${docId}/download`,
    headers: { 'Authorization': `Bearer ${tokenA}` }
  });
  console.log('  Staff A downloading own document Status:', ownStaffRes.status, 'Type:', ownStaffRes.headers['content-type']);
  assert.strictEqual(ownStaffRes.status, 200);
  assert.deepStrictEqual(ownStaffRes.rawBuffer, realPdfBytes);
  console.log('  ✓ Staff A successfully retrieved own document via staff endpoint');

  // G. Direct static unauthenticated access to /uploads/documents/*
  const directRes = await request({
    method: 'GET',
    path: `/uploads/documents/${createdLeave.attachment?.fileName}`
  });
  console.log('  Direct static access Status:', directRes.status);
  assert.strictEqual(directRes.status, 403);
  console.log('  ✓ Direct static unauthenticated access successfully blocked with 403 Forbidden');

  console.log('\n================================================================');
  console.log('   ALL 7 END-TO-END VERIFICATION CHECKS PASSED SUCCESSFULLY!    ');
  console.log('================================================================\n');
}

run().catch((err) => {
  console.error('\n❌ Test Suite Failed:', err);
  process.exit(1);
});
