import { Router, Request, Response } from 'express';
import { createAutomationRuleSchema } from './automation.schema';
import { db } from '../../config/database'; // Adjust path to your DB instance
import { v4 as uuidv4 } from 'uuid';

export const automationRouter = Router();

// Create a new automation rule
automationRouter.post('/', async (req: Request, res: Response) => {
  try {
    // 1. Validate Payload
    const parsedData = createAutomationRuleSchema.parse(req.body);
    const tenantId = req.headers['x-tenant-id'] as string; 

    // 2. Transactional Insert (Rule -> Conditions -> Actions)
    await db.transaction(async (trx: any) => {
      const ruleId = uuidv4();
      
      // Assume automation_rules table exists as parent to conditions/actions
      await trx('automation_rules').insert({
        rule_id: ruleId,
        tenant_id: tenantId,
        rule_name: parsedData.rule_name,
        trigger_event: parsedData.trigger_event,
        is_active: parsedData.is_active
      });

      // Insert Conditions
      const conditions = parsedData.conditions.map(cond => ({
        condition_id: uuidv4(),
        rule_id: ruleId,
        field: cond.field,
        operator: cond.operator,
        value: cond.value
      }));
      await trx('automation_conditions').insert(conditions);

      // Insert Actions
      const actions = parsedData.actions.map(act => ({
        action_id: uuidv4(),
        rule_id: ruleId,
        action_type: act.action_type,
        configuration: JSON.stringify(act.configuration) // stored as JSONB
      }));
      await trx('automation_actions').insert(actions);
    });

    res.status(201).json({ message: 'Automation rule created successfully.' });
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: 'Validation Failed', details: error.errors });
    }
    console.error('[Automation Error]:', error);
    res.status(500).json({ error: 'Failed to create automation rule' });
  }
});

// Fetch tenant automations
automationRouter.get('/', async (req: Request, res: Response) => {
  try {
    const tenantId = req.headers['x-tenant-id'];
    
    // Fetch rules (In production, use joins to attach conditions/actions)
    const rules = await db('automation_rules').where({ tenant_id: tenantId });
    
    res.status(200).json({ data: rules });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch automations' });
  }
});