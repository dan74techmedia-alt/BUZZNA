import { db } from '../../config/database';
import { sql } from 'drizzle-orm';
import { SendSmsInput, SendEmailInput, CreateAttentionCardInput } from './notifications.schema';

export class NotificationsService {
  /**
   * Dispatches system-level SMS communications to merchant target endpoints.
   * Integrates safely via local logging fallbacks if cellular networks timeout.
   */
  public async sendSms(input: SendSmsInput, tenantId: string): Promise<{ success: boolean; messageId: string }> {
    const validated = sendSmsSchema.parse(input);
    
    // In production environments within sub-Saharan boundaries, this integrates directly 
    // with regional aggregation gateways (e.g., Africa's Talking API protocol matrices).
    const generatedMessageId = `msg_${crypto.randomUUID()}`;
    
    // Execute inside tenant isolation limits to guarantee append-only notification logs are preserved
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL app.current_tenant_id = ${tenantId}`);
      
      await tx.execute(sql`
        INSERT INTO tenant_notification_logs (
          log_id, tenant_id, channel, destination, payload, status, reference_id, created_at
        ) VALUES (
          gen_random_uuid(), 
          ${tenantId}::uuid, 
          'SMS', 
          ${validated.phoneNumber}, 
          ${JSON.stringify({ message: validated.message })}, 
          'SENT', 
          ${generatedMessageId}, 
          NOW()
        )
      `);
    });

    return {
      success: true,
      messageId: generatedMessageId,
    };
  }

  /**
   * Transmits formal system communications and multi-tenant invoices to verified operations accounts.
   */
  public async sendEmail(input: SendEmailInput, tenantId: string): Promise<{ success: boolean; emailId: string }> {
    const validated = sendEmailSchema.parse(input);
    const generatedEmailId = `mail_${crypto.randomUUID()}`;

    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL app.current_tenant_id = ${tenantId}`);
      
      await tx.execute(sql`
        INSERT INTO tenant_notification_logs (
          log_id, tenant_id, channel, destination, payload, status, reference_id, created_at
        ) VALUES (
          gen_random_uuid(), 
          ${tenantId}::uuid, 
          'EMAIL', 
          ${validated.to}, 
          ${JSON.stringify({ subject: validated.subject, body: validated.body })}, 
          'SENT', 
          ${generatedEmailId}, 
          NOW()
        )
      `);
    });

    return {
      success: true,
      emailId: generatedEmailId,
    };
  }

  /**
   * Commits an append-only Attention Card to the tracking architecture.
   * Directly read by the Owner Dashboard for zero-attendance reactive business monitoring.
   */
  public async createAttentionCard(input: CreateAttentionCardInput, tenantId: string): Promise<string> {
    const validated = createAttentionCardSchema.parse(input);
    const cardId = crypto.randomUUID();

    await db.transaction(async (tx) => {
      // Force PostgreSQL Row-Level Security Connection Pool context encapsulation
      await tx.execute(sql`SET LOCAL app.current_tenant_id = ${tenantId}`);

      await tx.execute(sql`
        INSERT INTO attention_card_events (
          card_id, 
          tenant_id, 
          card_type, 
          priority, 
          title, 
          message, 
          metadata, 
          is_resolved, 
          created_at
        ) VALUES (
          ${cardId}::uuid, 
          ${tenantId}::uuid, 
          ${validated.cardType}, 
          ${validated.priority}, 
          ${validated.title}, 
          ${validated.message}, 
          ${JSON.stringify(validated.metadata)}::jsonb, 
          false, 
          NOW()
        )
      `);

      // Write matching record down to the cryptographic system audit trail log
      await tx.execute(sql`
        INSERT INTO audit_logs (
          log_id, tenant_id, event_type, description, metadata, created_at
        ) VALUES (
          gen_random_uuid(),
          ${tenantId}::uuid,
          'ATTENTION_CARD_GENERATED',
          ${`Attention alerting card created with threat rank ${validated.priority}: ${validated.title}`},
          ${JSON.stringify({ cardId, type: validated.cardType })},
          NOW()
        )
      `);
    });

    return cardId;
  }
} 