
# PROJECT STRUCTURE

```
.GitHub/
  workflows/
    project-intelligence.yml ✅
.gitignore ✅
.vscode/
  launch.json ✅
apps/
  .gitkeep 🔴 Empty
  api/
    package.json ✅
    src/
      bootstrap/
        app.ts ✅
        load-env.ts ✅
        server.ts ✅
      common/
        errors/
          AppError.ts ✅
          errorHandler.ts ✅
        logging/
          logger.ts ✅
        middleware/
          auth.middleware.ts ✅
          license-lockdown.middleware.ts ✅
        tenant-context.ts ✅
      config/
        database.ts ✅
        redis.ts ✅
      db/
        client.ts ✅
        migrations/
          schema.ts ✅
      index.ts 🔴 Empty
      modules/
        .gitkeep 🔴 Empty
        analytics/
          analytics.controller.ts ✅
          analytics.schema.ts ✅
          analytics.service.ts ✅
        audit-security/
          audit.service.ts ✅
        auth/
          auth.controller.ts ✅
          auth.schema.ts ✅
          auth.service.ts ✅
        automation/
          automation.controller.ts ✅
          automation.schema.ts ✅
          automation.service.ts ✅
        billing/
          billing.schema.ts ✅
          billing.service.ts ✅
          paystack.controller.ts ✅
        catalog/
          catalog.controller.ts ✅
          catalog.schema.ts ✅
          catalog.service.ts ✅
        customers/
          customers.controller.ts ✅
          customers.schema.ts ✅
          customers.service.ts ✅
        expenses/
          expenses.controller.ts ✅
          expenses.schema.ts ✅
          expenses.service.ts ✅
        inventory/
          inventory.controller.ts ✅
          inventory.schema.ts ✅
          inventory.service.ts ✅
        merchant-payments/
          daraja.controller.ts ✅
          daraja.schema.ts ✅
          daraja.service.ts ✅
          offlineSmsBridge.ts ✅
        notifications/
          notifications.controller.ts ✅
          notifications.schema.ts ✅
          notifications.service.ts ✅
        rbac/
          rbac.service.ts ✅
        sales/
          sales.controller.ts ✅
          sales.schema.ts ✅
          sales.service.ts ✅
        suppliers/
          suppliers.controller.ts ✅
          suppliers.schema.ts ✅
          suppliers.service.ts ✅
        sync/
          sync.controller.ts ✅
          sync.schema.ts ✅
          sync.service.ts ✅
        tenancy/
          tenancy.service.ts ✅
        till/
          till.controller.ts ✅
          till.schema.ts ✅
          till.service.ts ✅
      workers/
        billing-reminders.worker.ts ✅
        merchant-reconciliation.worker.ts ✅
        projection-rebuild.worker.ts ✅
        report-exporter.worker.ts ✅
    tsconfig.json ✅
  web/
    index.html ✅
    package.json ✅
    src/
      App.tsx ✅
      main.tsx ✅
      offline/
        db.ts ✅
        syncmanager.ts ✅
      pages/
        Billing.tsx ✅
        Dashboard.tsx ✅
        Inventory.tsx ✅
        Login.tsx ✅
        MerchantPayments.tsx ✅
        PosConsole.tsx ✅
        TillManagement.tsx ✅
      providers/
        ThemeProvider.tsx ✅
    vite.config.ts ✅
automation/
  project-intelligence.js ✅
capacitor.config.ts ✅
database/
  migrations/
    0001_extensions_and_enums.sql ✅
    0002_businesses_and_business_settings.sql ✅
    0003_roles_users_permissions_auth_tables.sql ✅
    0004_product_categories_products.sql ✅
    0005_inventory_events_stock_counts.sql ✅
    0006_till_sessions.sql ✅
    0007_sales_sale_items_payment_allocations_voids_refunds.sql ✅
    0008_expenses.sql ✅
    0009_customers_customer_ledger_repayments.sql ✅
    0010_suppliers_supplier_transactions.sql ✅
    0011_subscription_plans_invoices_payments_license_audit.sql ✅
    0012_merchant_payment_connections_payments_matches_events.sql ✅
    0013_sync_tables.sql ✅
    0014_automation_notifications_audit.sql ✅
    0015_views_indexes_rls.sql ✅
    0016_seed_core.sql ✅
package-lock.json ✅
package.json ✅
packages/
  shared-types/
    index.ts ✅
  shared-utils/
    index.ts ✅
  shared-validation/
    index.ts ✅
pnpm-workspace.yaml ✅
PROJECT_PROGRESS.md ✅
PROJECT_STATUS.md ✅
PROJECT_STRUCTURE.md ✅
README.md ✅
```
