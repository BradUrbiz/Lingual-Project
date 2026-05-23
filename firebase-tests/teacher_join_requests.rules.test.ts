import { initializeTestEnvironment, RulesTestEnvironment, assertFails, assertSucceeds }
    from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { readFileSync } from 'fs';
import { describe, it, beforeAll, beforeEach, afterAll } from 'vitest';

let env: RulesTestEnvironment;

beforeAll(async () => {
    env = await initializeTestEnvironment({
        projectId: 'lingu-480600',
        firestore: { rules: readFileSync('../firestore.rules', 'utf8') },
    });
});

afterAll(async () => { await env.cleanup(); });

beforeEach(async () => {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (ctx) => {
        const db = ctx.firestore();
        await setDoc(doc(db, 'memberships/admin-mem'), {
            uid: 'admin-1', org_id: 'org-1',
            roles: ['school_admin'], status: 'active',
        });
        await setDoc(doc(db, 'organizations/org-1'), { school_admin_uids: ['admin-1'] });
        await setDoc(doc(db, 'organizations/org-other'), { school_admin_uids: [] });
        await setDoc(doc(db, 'teacher_join_requests/tjr-1'), {
            uid: 'teacher-1', org_id: 'org-1',
            source: 'search', status: 'pending',
        });
        await setDoc(doc(db, 'teacher_join_requests/tjr-2'), {
            uid: 'teacher-2', org_id: 'org-other',
            source: 'search', status: 'pending',
        });
    });
});

describe('teacher_join_requests/{requestId}', () => {
    it('requester can read own request', async () => {
        const ctx = env.authenticatedContext('teacher-1');
        await assertSucceeds(getDoc(doc(ctx.firestore(), 'teacher_join_requests/tjr-1')));
    });

    it('requester cannot read others\' requests', async () => {
        const ctx = env.authenticatedContext('teacher-1');
        await assertFails(getDoc(doc(ctx.firestore(), 'teacher_join_requests/tjr-2')));
    });

    it('unauthenticated cannot read', async () => {
        const ctx = env.unauthenticatedContext();
        await assertFails(getDoc(doc(ctx.firestore(), 'teacher_join_requests/tjr-1')));
    });

    it('school_admin can read requests for own org', async () => {
        const ctx = env.authenticatedContext('admin-1');
        await assertSucceeds(getDoc(doc(ctx.firestore(), 'teacher_join_requests/tjr-1')));
    });

    it('school_admin cannot read other orgs\' requests', async () => {
        const ctx = env.authenticatedContext('admin-1');
        await assertFails(getDoc(doc(ctx.firestore(), 'teacher_join_requests/tjr-2')));
    });

    it('client cannot write directly (all writes via backend admin SDK)', async () => {
        const ctx = env.authenticatedContext('teacher-1');
        await assertFails(setDoc(doc(ctx.firestore(), 'teacher_join_requests/tjr-3'), {
            uid: 'teacher-1', org_id: 'org-1', source: 'search', status: 'pending',
        }));
    });
});
