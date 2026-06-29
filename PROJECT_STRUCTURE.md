
# PROJECT STRUCTURE

```
.GitHub/
  workflows/
    project-intelligence.yml ✅
.gitkeep 🔴 Empty
PROJECT_PROGRESS.md ✅
PROJECT_STATUS.md ✅
PROJECT_STRUCTURE.md ✅
README.md ✅
apps/
  .gitkeep 🔴 Empty
  api/
    package.json ✅
    src/
      .gitkeep 🔴 Empty
      bootstrap/
        app.ts ✅
      common/
        errors/
          .gitkeep 🔴 Empty
        logging/
          .gitkeep 🔴 Empty
        middleware/
          license-lockdown.middleware.ts ✅
        tenant-context.ts ✅
      config/
        database.ts ✅
      db/
        .gitkeep 🔴 Empty
        migrations/
          schema.ts ✅
      modules/
        .gitkeep 🔴 Empty
        analytics/
          analytics.controller.ts ✅
          analytics.service.ts ✅
        audit-security/
          .gitkeep 🔴 Empty
        auth/
          auth.controller.ts ✅
          auth.schema.ts ✅
        automation/
          automation.controller.ts ✅
          automation.schema.ts ✅
          automation.service.ts ✅
        billing/
          paystack.controller.ts ✅
        catalog/
          catalog.controller.ts ✅
          catalog.schema.ts ✅
        customers/
          .gitkeep 🔴 Empty
        expenses/
          .gitkeep 🔴 Empty
        inventory/
          inventory.controller.ts ✅
          inventory.schema.ts ✅
        merchant-payments/
          daraja.controller.ts ✅
        notifications/
          .gitkeep 🔴 Empty
        rbac/
          .gitkeep 🔴 Empty
        sales/
          sales.controller.ts ✅
          sales.schema.ts ✅
        suppliers/
          .gitkeep 🔴 Empty
        sync/
          sync.controller.ts ✅
        tenancy/
          .gitkeep 🔴 Empty
        till/
          tii.schema.ts ✅
          till.controller.ts ✅
      workers/
        merchant-reconciliation.worker.ts ✅
        projection-rebuild.worker.ts ✅
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
        PosConsole.tsx ✅
      providers/
        ThemeProvider.tsx ✅
    vite.config.ts ✅
automation/
  project-intelligence.js ✅
database/
  migrations/
    0001_extensions_and_enums.sql ✅
    0002_businesses_and_business_settings.sql ✅
    0003_roles_users_permissions_auth_tables.sql ✅
    0004_product_categories_products.sql ✅
    0005_inventory_events_stock_counts.sql ✅
package.json ✅
packages/
  .gitkeep 🔴 Empty
  shared-types/
    .gitkeep 🔴 Empty
  shared-utils/
    .gitkeep 🔴 Empty
  shared-validation/
    .gitkeep 🔴 Empty
```
