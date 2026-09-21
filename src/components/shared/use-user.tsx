"use client";

/** کانتکست کاربر — توسط page.tsx فراهم و در همه ویوها استفاده می‌شود */

import { createContext, useContext } from "react";

export type SessionUser = {
  id: string;
  username: string;
  fullName: string;
  roleKey: string;
  roleName: string;
  permissions: string[];
  branchId: string | null;
  branchName: string | null;
  isSuperAdmin: boolean;
};

export type UserContextValue = {
  user: SessionUser;
  hasPermission: (perm: string) => boolean;
  refreshUser: () => void;
};

export const UserContext = createContext<UserContextValue | null>(null);

export function useUser(): UserContextValue {
  const ctx = useContext(UserContext);
  if (!ctx) {
    throw new Error("useUser باید داخل UserContext.Provider استفاده شود");
  }
  return ctx;
}

export function makeHasPermission(user: SessionUser) {
  return (perm: string) => {
    if (user.isSuperAdmin) return true;
    return user.permissions.includes(perm);
  };
}

/** کامپوننت محافظت‌شده: اگر کاربر صلاحیت نداشته باشد پیام مناسب نشان می‌دهد */
export function PermissionGate({
  permission,
  children,
}: {
  permission: string;
  children: React.ReactNode;
}) {
  const { hasPermission } = useUser();
  if (!hasPermission(permission)) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-lg border border-dashed">
        <span className="text-4xl">🔒</span>
        <p className="text-sm text-muted-foreground">
          شما صلاحیت دسترسی به این بخش را ندارید
        </p>
      </div>
    );
  }
  return <>{children}</>;
}
