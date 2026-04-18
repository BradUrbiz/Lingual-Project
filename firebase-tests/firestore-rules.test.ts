import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { readFileSync } from 'fs';
import { describe, it, beforeAll, beforeEach, afterAll } from 'vitest';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'lingu-480600',
    firestore: {
      rules: readFileSync('../firestore.rules', 'utf8'),
    },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();

  // Seed test data using admin context (bypasses rules)
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

    // Users
    await setDoc(doc(db, 'users', 'teacher1'), {
      last_active_membership_id: 'mem_teacher1',
    });
    await setDoc(doc(db, 'users', 'admin1'), {
      last_active_membership_id: 'mem_admin1',
    });
    await setDoc(doc(db, 'users', 'student1'), {
      last_active_membership_id: 'mem_student1',
    });
    await setDoc(doc(db, 'users', 'outsider'), {});

    // Memberships
    await setDoc(doc(db, 'memberships', 'mem_teacher1'), {
      org_id: 'org1', uid: 'teacher1', roles: ['teacher'], status: 'active',
    });
    await setDoc(doc(db, 'memberships', 'mem_admin1'), {
      org_id: 'org1', uid: 'admin1', roles: ['school_admin'], status: 'active',
    });
    await setDoc(doc(db, 'memberships', 'mem_student1'), {
      org_id: 'org1', uid: 'student1', roles: ['student'], status: 'active',
    });

    // Organization
    await setDoc(doc(db, 'organizations', 'org1'), { name: 'Test School' });

    // Class
    await setDoc(doc(db, 'classes', 'class1'), {
      org_id: 'org1', teacher_membership_ids: ['mem_teacher1'],
    });

    // Enrollment (composite ID matching rule: classId + '_' + uid)
    await setDoc(doc(db, 'enrollments', 'class1_student1'), {
      class_id: 'class1', student_uid: 'student1', status: 'active',
    });

    // Assignment
    await setDoc(doc(db, 'assignments', 'assign1'), {
      class_id: 'class1',
    });

    // Compliance record
    await setDoc(doc(db, 'student_compliance_records', 'rec1'), {
      org_id: 'org1', student_uid: 'student1',
    });

    // Consent event
    await setDoc(doc(db, 'consent_events', 'evt1'), {
      org_id: 'org1', student_uid: 'student1',
    });

    // Deletion request
    await setDoc(doc(db, 'deletion_requests', 'del1'), {
      org_id: 'org1',
    });

    // Deletion execution run
    await setDoc(doc(db, 'deletion_execution_runs', 'run1'), {
      org_id: 'org1',
    });

    // Canvas connection (server-only, deny-all for clients)
    await setDoc(doc(db, 'canvas_connections', 'conn1'), {
      membership_id: 'mem_teacher1',
      org_id: 'org1',
      class_id: 'class1',
      canvas_instance_url: 'https://school.instructure.com',
      canvas_course_id: '12345',
      encrypted_pat: 'encrypted_data_here',
    });

    // Canvas course content (enrolled students can read)
    await setDoc(doc(db, 'canvas_course_content', 'content1'), {
      connection_id: 'conn1',
      class_id: 'class1',
      canvas_module_position: 1,
      item_position: 1,
      title: 'Module 1 - Item 1',
    });
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

// Helper: get authenticated firestore for a specific user
function authedDb(uid: string) {
  return testEnv.authenticatedContext(uid).firestore();
}

function unauthDb() {
  return testEnv.unauthenticatedContext().firestore();
}

describe('users/{uid}', () => {
  it('owner can read own doc', async () => {
    const db = authedDb('teacher1');
    await assertSucceeds(getDoc(doc(db, 'users', 'teacher1')));
  });

  it('owner can write own doc', async () => {
    const db = authedDb('teacher1');
    await assertSucceeds(setDoc(doc(db, 'users', 'teacher1'), { name: 'updated' }));
  });

  it('other user cannot read', async () => {
    const db = authedDb('outsider');
    await assertFails(getDoc(doc(db, 'users', 'teacher1')));
  });

  it('other user cannot write', async () => {
    const db = authedDb('outsider');
    await assertFails(setDoc(doc(db, 'users', 'teacher1'), { name: 'hacked' }));
  });
});

describe('organizations/{orgId}', () => {
  it('active org member can read', async () => {
    const db = authedDb('teacher1');
    await assertSucceeds(getDoc(doc(db, 'organizations', 'org1')));
  });

  it('non-member cannot read', async () => {
    const db = authedDb('outsider');
    await assertFails(getDoc(doc(db, 'organizations', 'org1')));
  });

  it('nobody can write', async () => {
    const db = authedDb('admin1');
    await assertFails(setDoc(doc(db, 'organizations', 'org1'), { name: 'hacked' }));
  });
});

describe('memberships/{membershipId}', () => {
  it('owner can read own membership', async () => {
    const db = authedDb('teacher1');
    await assertSucceeds(getDoc(doc(db, 'memberships', 'mem_teacher1')));
  });

  it('school_admin can read org member memberships', async () => {
    const db = authedDb('admin1');
    await assertSucceeds(getDoc(doc(db, 'memberships', 'mem_teacher1')));
  });

  it('non-owner non-admin cannot read', async () => {
    const db = authedDb('outsider');
    await assertFails(getDoc(doc(db, 'memberships', 'mem_teacher1')));
  });

  it('nobody can write', async () => {
    const db = authedDb('admin1');
    await assertFails(setDoc(doc(db, 'memberships', 'mem_teacher1'), { roles: ['school_admin'] }));
  });
});

describe('classes/{classId}', () => {
  it('teacher in teacher_membership_ids can read', async () => {
    const db = authedDb('teacher1');
    await assertSucceeds(getDoc(doc(db, 'classes', 'class1')));
  });

  it('enrolled student can read', async () => {
    const db = authedDb('student1');
    await assertSucceeds(getDoc(doc(db, 'classes', 'class1')));
  });

  it('outsider cannot read', async () => {
    const db = authedDb('outsider');
    await assertFails(getDoc(doc(db, 'classes', 'class1')));
  });

  it('nobody can write', async () => {
    const db = authedDb('teacher1');
    await assertFails(setDoc(doc(db, 'classes', 'class1'), { name: 'changed' }));
  });
});

describe('enrollments/{enrollmentId}', () => {
  it('student can read own enrollment', async () => {
    const db = authedDb('student1');
    await assertSucceeds(getDoc(doc(db, 'enrollments', 'class1_student1')));
  });

  it('class teacher can read', async () => {
    const db = authedDb('teacher1');
    await assertSucceeds(getDoc(doc(db, 'enrollments', 'class1_student1')));
  });

  it('outsider cannot read', async () => {
    const db = authedDb('outsider');
    await assertFails(getDoc(doc(db, 'enrollments', 'class1_student1')));
  });

  it('nobody can write', async () => {
    const db = authedDb('teacher1');
    await assertFails(setDoc(doc(db, 'enrollments', 'class1_student1'), { status: 'removed' }));
  });
});

describe('assignments/{assignmentId}', () => {
  it('class teacher can read', async () => {
    const db = authedDb('teacher1');
    await assertSucceeds(getDoc(doc(db, 'assignments', 'assign1')));
  });

  it('enrolled student can read', async () => {
    const db = authedDb('student1');
    await assertSucceeds(getDoc(doc(db, 'assignments', 'assign1')));
  });

  it('outsider cannot read', async () => {
    const db = authedDb('outsider');
    await assertFails(getDoc(doc(db, 'assignments', 'assign1')));
  });

  it('nobody can write', async () => {
    const db = authedDb('teacher1');
    await assertFails(setDoc(doc(db, 'assignments', 'assign1'), { title: 'changed' }));
  });
});

describe('student_compliance_records/{recordId}', () => {
  it('student can read own record', async () => {
    const db = authedDb('student1');
    await assertSucceeds(getDoc(doc(db, 'student_compliance_records', 'rec1')));
  });

  it('teacher in org can read', async () => {
    const db = authedDb('teacher1');
    await assertSucceeds(getDoc(doc(db, 'student_compliance_records', 'rec1')));
  });

  it('admin in org can read', async () => {
    const db = authedDb('admin1');
    await assertSucceeds(getDoc(doc(db, 'student_compliance_records', 'rec1')));
  });

  it('outsider cannot read', async () => {
    const db = authedDb('outsider');
    await assertFails(getDoc(doc(db, 'student_compliance_records', 'rec1')));
  });

  it('nobody can write', async () => {
    const db = authedDb('admin1');
    await assertFails(setDoc(doc(db, 'student_compliance_records', 'rec1'), { voice_allowed: true }));
  });
});

describe('consent_events/{eventId}', () => {
  it('school_admin in org can read', async () => {
    const db = authedDb('admin1');
    await assertSucceeds(getDoc(doc(db, 'consent_events', 'evt1')));
  });

  it('teacher cannot read', async () => {
    const db = authedDb('teacher1');
    await assertFails(getDoc(doc(db, 'consent_events', 'evt1')));
  });

  it('outsider cannot read', async () => {
    const db = authedDb('outsider');
    await assertFails(getDoc(doc(db, 'consent_events', 'evt1')));
  });

  it('nobody can write', async () => {
    const db = authedDb('admin1');
    await assertFails(setDoc(doc(db, 'consent_events', 'evt1'), { event_type: 'tampered' }));
  });
});

describe('deletion_requests/{requestId}', () => {
  it('school_admin in org can read', async () => {
    const db = authedDb('admin1');
    await assertSucceeds(getDoc(doc(db, 'deletion_requests', 'del1')));
  });

  it('teacher cannot read', async () => {
    const db = authedDb('teacher1');
    await assertFails(getDoc(doc(db, 'deletion_requests', 'del1')));
  });

  it('nobody can write', async () => {
    const db = authedDb('admin1');
    await assertFails(setDoc(doc(db, 'deletion_requests', 'del1'), { status: 'approved' }));
  });
});

describe('deletion_execution_runs/{runId}', () => {
  it('school_admin in org can read', async () => {
    const db = authedDb('admin1');
    await assertSucceeds(getDoc(doc(db, 'deletion_execution_runs', 'run1')));
  });

  it('teacher cannot read', async () => {
    const db = authedDb('teacher1');
    await assertFails(getDoc(doc(db, 'deletion_execution_runs', 'run1')));
  });

  it('nobody can write', async () => {
    const db = authedDb('admin1');
    await assertFails(setDoc(doc(db, 'deletion_execution_runs', 'run1'), { status: 'completed' }));
  });
});

describe('canvas_connections/{connectionId}', () => {
  it('teacher cannot read (server-only)', async () => {
    const db = authedDb('teacher1');
    await assertFails(getDoc(doc(db, 'canvas_connections', 'conn1')));
  });

  it('admin cannot read (server-only)', async () => {
    const db = authedDb('admin1');
    await assertFails(getDoc(doc(db, 'canvas_connections', 'conn1')));
  });

  it('student cannot read', async () => {
    const db = authedDb('student1');
    await assertFails(getDoc(doc(db, 'canvas_connections', 'conn1')));
  });

  it('outsider cannot read', async () => {
    const db = authedDb('outsider');
    await assertFails(getDoc(doc(db, 'canvas_connections', 'conn1')));
  });

  it('nobody can write', async () => {
    const db = authedDb('teacher1');
    await assertFails(setDoc(doc(db, 'canvas_connections', 'conn1'), { encrypted_pat: 'stolen' }));
  });
});

describe('canvas_course_content/{contentId}', () => {
  it('enrolled student can read', async () => {
    const db = authedDb('student1');
    await assertSucceeds(getDoc(doc(db, 'canvas_course_content', 'content1')));
  });

  it('teacher cannot read (server-only access for writes, student-only for reads)', async () => {
    const db = authedDb('teacher1');
    await assertFails(getDoc(doc(db, 'canvas_course_content', 'content1')));
  });

  it('outsider cannot read', async () => {
    const db = authedDb('outsider');
    await assertFails(getDoc(doc(db, 'canvas_course_content', 'content1')));
  });

  it('nobody can write', async () => {
    const db = authedDb('student1');
    await assertFails(setDoc(doc(db, 'canvas_course_content', 'content1'), { title: 'hacked' }));
  });
});

describe('catch-all', () => {
  it('denies read on unknown collection', async () => {
    const db = authedDb('admin1');
    await assertFails(getDoc(doc(db, 'unknown_collection', 'doc1')));
  });

  it('denies write on unknown collection', async () => {
    const db = authedDb('admin1');
    await assertFails(setDoc(doc(db, 'unknown_collection', 'doc1'), { data: 'test' }));
  });

  it('unauthenticated user denied everywhere', async () => {
    const db = unauthDb();
    await assertFails(getDoc(doc(db, 'users', 'teacher1')));
    await assertFails(getDoc(doc(db, 'organizations', 'org1')));
    await assertFails(getDoc(doc(db, 'classes', 'class1')));
  });
});
