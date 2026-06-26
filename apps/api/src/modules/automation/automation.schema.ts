import { z } from 'zod';

export const createAutomationRuleSchema = z.object({
  rule_name: z.string().min(3).max(100),
  trigger_event: z.enum(['LOW_STOCK', 'HIGH_SPOILAGE', 'END_OF_DAY', 'TILL_MISMATCH']),
  is_active: z.boolean().default(true),
  conditions: z.array(z.object({
    field: z.string(),
    operator: z.enum(['EQUALS', 'GREATER_THAN', 'LESS_THAN', 'CONTAINS']),
    value: z.string()
  })).min(1, "At least one condition is required"),
  actions: z.array(z.object({
    action_type: z.enum(['ALERT_OWNER', 'AUTO_ORDER', 'LOCK_TILL', 'DISCOUNT_ITEM']),
    configuration: z.record(z.any()) // JSON configuration for the specific action
  })).min(1, "At least one action is required")
});

export const syncEventSchema = z.object({
  client_event_id: z.string().uuid(),
  event_type: z.string(),
  payload: z.record(z.any()),
  occurred_at: z.string().datetime()
});