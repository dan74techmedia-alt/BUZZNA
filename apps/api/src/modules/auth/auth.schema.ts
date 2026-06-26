import { z } from 'zod';

export const registerBusinessSchema = z.object({
  legalName: z.string().min(2, "Business name is too short"),
  tradeName: z.string().optional(),
  onboardingSegment: z.enum(['RETAIL', 'BUTCHERY', 'MITUMBA', 'HARDWARE', 'CYBER']),
  ownerFullName: z.string().min(2, "Name is required"),
  username: z.string().min(4, "Username must be at least 4 characters"),
  password: z.string().min(8, "Password must be at least 8 characters"), 
});

export const loginSchema = z.object({
  username: z.string(),
  password: z.string(),
});