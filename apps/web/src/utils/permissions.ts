/**
 * RBAC Permission Constants
 * Defines strict access control for the application.
 * Must be kept in sync with the backend RLS policies.
 */

export enum Role {
  OWNER = 'OWNER',
  MANAGER = 'MANAGER',
  CASHIER = 'CASHIER'
}

export type Permission = 
  | 'read:sales' 
  | 'write:sales' 
  | 'void:sales'
  | 'read:inventory'
  | 'write:inventory'
  | 'manage:expenses'
  | 'manage:users'
  | 'view:reports';

export const RolePermissions: Record<Role, Permission[]> = {
  [Role.OWNER]: [
    'read:sales', 'write:sales', 'void:sales',
    'read:inventory', 'write:inventory',
    'manage:expenses', 'manage:users', 'view:reports'
  ],
  [Role.MANAGER]: [
    'read:sales', 'write:sales', 'void:sales',
    'read:inventory', 'write:inventory',
    'manage:expenses', 'view:reports'
  ],
  [Role.CASHIER]: [
    'read:sales', 'write:sales',
    'read:inventory'
  ]
};

export const hasPermission = (userRole: Role, permission: Permission): boolean => {
  return RolePermissions[userRole].includes(permission);
};