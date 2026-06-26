import { z } from 'zod';

// Schema for Business Registration
export const registerBusinessSchema = z.object({
  legalName: z.string().min(2, "Business name is too short"),
  tradeName: z.string().optional(),
  onboardingSegment: z.enum(['RETAIL', 'BUTCHERY', 'MITUMBA', 'HARDWARE', 'CYBER']),
  ownerFullName: z.string().min(2, "Name is required"),
  username: z.string().min(4, "Username must be at least 4 characters"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

// Schema for Login
export const loginSchema = z.object({
  username: z.string().min(4, "Username must be at least 4 characters"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

// Type Inference (Best Practice)
// This automatically creates a TypeScript type based on your schema
export type RegisterBusinessInput = z.infer<typeof registerBusinessSchema>;
export type LoginInput = z.infer<typeof loginSchema>;