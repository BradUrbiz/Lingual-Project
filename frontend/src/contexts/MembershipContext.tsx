/* eslint-disable react-refresh/only-export-components */
import { createContext, use, type ReactNode } from 'react';
import { useAuth } from '@/hooks/useAuth';
import type { MembershipSummary, SchoolRole } from '@/types';

interface MembershipContextType {
  memberships: MembershipSummary[];
  activeMembership: MembershipSummary | null;
  activeOrganizationId: string | null;
  activeRoles: SchoolRole[];
  hasRole: (role: SchoolRole) => boolean;
  hasAnyRole: (roles: SchoolRole[]) => boolean;
}

const MembershipContext = createContext<MembershipContextType | null>(null);

export function MembershipProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();

  const memberships = user?.memberships ?? [];
  const activeMembership =
    memberships.find((membership) => membership.id === user?.activeMembershipId) ?? memberships[0] ?? null;
  const activeRoles = (activeMembership?.roles ?? user?.activeRoles ?? []) as SchoolRole[];
  const allRoles = memberships.flatMap((membership) => membership.roles ?? []);
  const roleSet = new Set<SchoolRole>([...allRoles, ...activeRoles]);

  const value: MembershipContextType = {
    memberships,
    activeMembership,
    activeOrganizationId: user?.activeOrganizationId ?? activeMembership?.orgId ?? null,
    activeRoles,
    hasRole: (role) => roleSet.has(role),
    hasAnyRole: (roles) => roles.some((role) => roleSet.has(role)),
  };

  return <MembershipContext.Provider value={value}>{children}</MembershipContext.Provider>;
}

export function useMembership() {
  const context = use(MembershipContext);
  if (!context) {
    throw new Error('useMembership must be used within a MembershipProvider');
  }
  return context;
}
