
# PROJECT STRUCTURE

```
.GitHub/
  workflows/
    project-intelligence.yml ✅
.gitignore ✅
.husky/
  _/
    .gitignore ✅
    applypatch-msg ✅
    commit-msg ✅
    h ✅
    husky.sh ✅
    post-applypatch ✅
    post-checkout ✅
    post-commit ✅
    post-merge ✅
    post-rewrite ✅
    pre-applypatch ✅
    pre-auto-gc ✅
    pre-commit ✅
    pre-merge-commit ✅
    pre-push ✅
    pre-rebase ✅
    prepare-commit-msg ✅
.vscode/
  launch.json ✅
apps/
  .gitkeep 🔴 Empty
  api/
    .env ✅
    package-lock.json ✅
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
          audit.middleware.ts ✅
          auth.middleware.ts ✅
          cache.middleware.ts ✅
          compression.middleware.ts ✅
          idempotency.middleware.ts ✅
          license-lockdown.middleware.ts ✅
          rate-limit.middleware.ts ✅
          rbac.middleware.ts ✅
          request-id.middleware.ts ✅
          tenant-transaction.middleware.ts ✅
          validation.middleware.ts ✅
          webhook-verification.middleware.ts ✅
        tenant-context.ts ✅
      config/
        bullmq.ts ✅
        daraja.ts ✅
        database.ts ✅
        env.ts ✅
        paystack.ts ✅
        queues.ts ✅
        redis.ts ✅
      db/
        client.ts ✅
        migrations/
          schema.ts ✅
      index.ts ✅
      modules/
        .gitkeep 🔴 Empty
        analytics/
          analytics.controller.ts ✅
          analytics.schema.ts ✅
          analytics.service.ts ✅
        audit-security/
          audit.service.ts ✅
          security.service.ts ✅
        auth/
          auth.controller.ts ✅
          auth.schema.ts ✅
          auth.service.ts ✅
        automation/
          automation.controller.ts ✅
          automation.schema.ts ✅
          automation.service.ts ✅
        billing/
          billing.controllers.ts ✅
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
          email.service.ts ✅
          notifications.controller.ts ✅
          notifications.schema.ts ✅
          notifications.service.ts ✅
          push.service.ts ✅
          sms.service.ts ✅
        rbac/
          rbac.service.ts ✅
        reports/
          csv.service.ts ✅
          pdf.service.ts ✅
          report.service.ts ✅
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
          tenancy.controller.ts ✅
          tenancy.service.ts ✅
        till/
          till.controller.ts ✅
          till.schema.ts ✅
          till.service.ts ✅
      routes/
        analytics.routes.ts ✅
        auth.routes.ts ✅
        billing.routes.ts ✅
        catalog.routes.ts ✅
        customer.routes.ts ✅
        expenses.routes.ts ✅
        index.ts ✅
        inventory.routes.ts ✅
        merchant-payments.routes.ts ✅
        notifications.routes.ts ✅
        sales.routes.ts ✅
        suppliers.routes.ts ✅
        sync.routes.ts ✅
        tenancy.routes.ts ✅
        till.routes.ts ✅
      types/
        express.d.ts ✅
      workers/
        analytics-refresh.worker.ts ✅
        audit-pruning.worker.ts ✅
        billing-reminders.worker.ts ✅
        cache-refresh.worker.ts ✅
        customer-aging.worker.ts ✅
        index.ts ✅
        license-expiry.worker.ts ✅
        merchant-reconciliation.worker.ts ✅
        notification.worker.ts ✅
        projection-rebuild.worker.ts ✅
        report-exporter.worker.ts ✅
        stale-stock.worker.ts ✅
        sync-cleanup.worker.ts ✅
    tsconfig.json ✅
  web/
    .env ✅
    index.html ✅
    package.json ✅
    src/
      App.tsx ✅
      components/
        OfflineIndicator.tsx ✅
        ProtectedRoute.tsx ✅
      features/
        auth/
          authStorage.ts ✅
        pos/
          CartTable.tsx ✅
        sync/
          ConflictResolutionDialog.tsx ✅
          SyncQueue.tsx ✅
          SyncStatus.tsx ✅
      hooks/
        useProducts.ts ✅
        useSync.ts ✅
      layouts/
        PosLayout.tsx ✅
      main.tsx ✅
      offline/
        db.ts ✅
        syncmanager.ts ✅
      pages/
        Billing.tsx ✅
        Customers.tsx ✅
        Dashboard.tsx ✅
        Expenses.tsx ✅
        Inventory.tsx ✅
        Login.tsx ✅
        MerchantPayments.tsx ✅
        PosConsole.tsx ✅
        TillManagement.tsx ✅
      providers/
        ThemeProvider.tsx ✅
      router.tsx ✅
      store/
        auth.store.ts ✅
        cart.store.ts ✅
        pos.store.ts ✅
      utils/
        api.ts ✅
        axios.ts ✅
        constants.ts ✅
        formatCurrency.ts ✅
        formatDate.ts ✅
        permissions.ts ✅
        validators.ts ✅
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
pnpm-lock.yaml ✅
pnpm-workspace.yaml ✅
PROJECT_PROGRESS.md ✅
PROJECT_STATUS.md ✅
PROJECT_STRUCTURE.md ✅
README.md ✅
```
