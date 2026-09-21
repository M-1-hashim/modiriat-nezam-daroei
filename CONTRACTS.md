# CONTRACTS.md — قراردادهای مشترک پروژه (هر ایجنت موظف به رعایت کامل)

> **هیچ ایجنتی حق ویرایش فایل‌های پایه زیر را ندارد:** `prisma/schema.prisma`, `src/lib/*`, `src/components/shared/*`, `src/app/page.tsx`, `src/app/layout.tsx`, `src/app/globals.css`, `CONTRACTS.md`, `worklog.md`.
> هر ایجنت فقط روی پوشه/فایل‌های تعیین‌شده در تسک خودش کار می‌کند.

---

## 1. قواعد کلی

- استک: Next.js 16 App Router، TypeScript سخت‌گیرانه، Tailwind 4، shadcn/ui (اجزای موجود در `src/components/ui`)، Prisma + SQLite (`import { db } from "@/lib/db"`).
- **API فقط با route handlers در `src/app/api/**/route.ts`** (نه server action). Response همیشه:

```json
{ "ok": true, "data": ... }
{ "ok": false, "error": { "message": "پیام دری", "code": "OPTIONAL_CODE" } }
```

- استفاده از helperهای `src/lib/api-utils.ts`: `ok(data)`, `fail(msg, status)`, `ApiError`, `handleApiError(e)`, `round2`, `round4`, `toNum`, `parseDate`.
- كل route handler در try/catch و در انتها `return handleApiError(e)`.
- **امنیت شعبه‌ای در بک‌اند اجباری است**: هر API باید با `requireUser()` شروع شود، صلاحیت با `requirePermission(user, "module.action")` چک شود و برای هر resource متعلق به شعبه، `assertBranchAccess(user, record.branchId)` یا فیلتر `allowedBranchIds(user)` اعمال شود. کاربر غیر-سوپرادمین هرگز نباید با تغییر id/URL به داده شعبه دیگر دسترسی یابد. کاربر معمولی `branchId` ارسالی در body نادیده گرفته می‌شود و همیشه `user.branchId` جایگزین می‌شود.
- پول: `Float` + `round2`؛ نرخ اسعار: `round4`. هر تراکنش `currency` + `exchangeRate` خودش را ذخیره می‌کند و هرگز با نرخ روز بازمحاسبه نمی‌شود.
- id همه مدل‌ها `cuid` است. هر تراکنش ایجاد-شده-آفلاین `localId` (uuid) یکتا دارد؛ endpointهای ایجاد اگر `localId` تکراری دیدند باید همان رکورد موجود را برگردانند (idempotent).
- مالکیت فایل‌ها:
  - 2-a: `src/app/api/auth/**`, `setup`, `users`, `roles`, `branches`, `warehouses`, `territories`, `salespersons`, `settings`, `audit`, `backups`, `seed`, `search`, `notifications`, `sync`
  - 2-b: `src/app/api/products`, `categories`, `manufacturers`, `batches`, `stock`
  - 2-c: `src/app/api/purchases`, `suppliers`, `sales`, `customers`, `payments`, `returns`
  - 2-d: `src/app/api/expenses`, `expense-categories`, `partners`, `partnerships`, `exchange-rates`, `reports`, `dashboard`
  - 3-a..3-d: فقط `src/components/views/<ViewName>.tsx` مال خودشان.

## 2. مدل‌های کلیدی Prisma (خلاصه)

- `Branch(code,name,isHeadOffice,isActive)`، `Role(key,name,permissions:"[\"sales.view\",...]\"|\"[\"*\"]\")`، `User(username,passwordHash,fullName,roleId,branchId?,isActive)`، `Session(token,userId,expiresAt)`
- `Warehouse(branchId,name,isMain)`، `Territory(branchId,name)`، `Salesperson(branchId,name,commission,territories m2m)`
- `Customer(branchId,type,name,territoryId?,salespersonId?,creditLimit,paymentTerms,balance,isActive)` — balance مثبت = بدهی مشتری به ما
- `Supplier(type LOCAL|FOREIGN,name,country,balance)` — balance مثبت = بدهی ما به تأمین‌کننده
- `Category(name)`، `Manufacturer(name,country)`، `Product(name,genericName,categoryId?,manufacturerId?,dosageForm,strength,unit,packaging,barcode,storeCondition,purchasePrice,salePrice,minStock,maxStock)`
- `Batch(productId,batchNumber,mfgDate?,expiryDate?,costPrice,status,purchaseId?)` unique(productId,batchNumber)
- `StockItem(productId,batchId,warehouseId,quantity)` unique(productId,batchId,warehouseId)
- `StockMovement(productId,batchId,fromWarehouseId?,toWarehouseId?,type,quantity,reason,referenceType?,referenceId?,userId,userName,branchId,localId?)` — type: IN|OUT|TRANSFER|ADJUSTMENT|RETURN_IN|RETURN_OUT|DAMAGE|EXPIRED
- `Purchase(number,localId,branchId,supplierId,warehouseId,type LOCAL|IMPORT|FOREIGN,date,currency,exchangeRate,subtotal,discountTotal,extraCost,total,totalAfn,paidAmount,returnedAfn,status DRAFT|PENDING|APPROVED|COMPLETED|CANCELLED,notes,createdBy,createdByName,approvedBy?,approvedAt?)`
- `PurchaseItem(purchaseId,productId,batchNumber,mfgDate?,expiryDate?,quantity,freeQuantity,unitPrice,discountPct,discountAmount,netUnitPrice,effectiveCost,promotionNote?,lineTotal,lineTotalAfn,batchId?)`
- `Sale(number,localId,branchId,customerId,warehouseId,salespersonId?,territoryId?,type WHOLESALE|CASH|CREDIT,invoiceTemplate,date,currency,exchangeRate,subtotal,discountTotal,total,totalAfn,paidAmount,returnedAfn,status,notes,createdBy,createdByName,approvedBy?,approvedAt?)`
- `SaleItem(saleId,productId,batchId,quantity,freeQuantity,unitPrice,discountPct,discountAmount,netUnitPrice,promotionNote?,costAtSale,lineTotal,lineTotalAfn)`
- `Payment(number,localId,type CUSTOMER|SUPPLIER,direction IN|OUT,branchId,customerId?,supplierId?,saleId?,purchaseId?,amount,currency,exchangeRate,method CASH|BANK|HAWALA,reference?,date,notes?,createdBy,createdByName,status COMPLETED|CANCELLED)`
- `SalesReturn(number,localId,saleId,branchId,customerId,warehouseId,date,totalAfn,status REQUESTED|APPROVED|CANCELLED,reason,createdBy,createdByName,approvedBy?)` + `SalesReturnItem(returnId,saleItemId,productId,batchId,quantity,unitPriceAfn,lineTotalAfn)`
- `PurchaseReturn(...)` + `PurchaseReturnItem(returnId,purchaseItemId,productId,batchId,quantity,unitCostAfn,lineTotalAfn)`
- `ExpenseCategory(name)`، `Expense(localId,branchId,categoryId,amount,currency,exchangeRate,amountAfn,date,description?,status PENDING|APPROVED|PAID|CANCELLED,createdBy,createdByName,approvedBy?)`
- `Partner(name,phone,isActive)`، `Partnership(branchId,partnerId,type EQUITY|MUDARABAH,role?,capital,profitSharePct,lossSharePct,profitMethod?,startDate,endDate?,terms?,status ACTIVE|ENDED|SUSPENDED)`
- `ProfitDistribution(partnershipId,periodFrom,periodTo,revenueAfn,cogsAfn,grossProfitAfn,expensesAfn,netProfitAfn,distributionBase,baseAmountAfn,sharePct,partnerShareAfn,status CALCULATED|APPROVED|PAID,createdBy)`
- `ExchangeRate(base,quote,buyRate,sellRate,source API|MANUAL,isOffline,recordedBy?,recordedByName?,createdAt)`؛ `CurrencySettings(apiEndpoint,apiKey?,refreshMinutes,mapping,lastSyncAt?,lastSyncStatus?,lastSyncError?,enabled)`
- `SystemSetting(key,value)`، `NumberSequence(branchId,docType,prefix,current) unique(branchId,docType)`
- `AuditLog(userId?,userName?,branchId?,action,entity,entityId?,summary?,before?,after?,ip?,createdAt)`
- `Notification(type,severity,title,message?,branchId?,userId?,isRead,createdAt)`، `Backup(filename,size,type,note?,createdBy?,createdByName?,createdAt)`، `SyncLog(deviceId,localId,entityType,entityId?,status SYNCED|DUPLICATE|FAILED|CONFLICT,message?,userId,createdAt)`

## 3. توابع موتور کسب‌وکار (`src/lib/business.ts`) — استفاده کن، بازنویسی نکن

```ts
await db.$transaction(async (tx) => { ... })            // هر عملیات مالی/موجودی در تراکنش
await nextDocNumber(tx, branchId, docType)              // docType: PURCHASE|SALE|PAYMENT|PURCHASE_RETURN|SALES_RETURN → "PUR-KBL-00001"
await createBatchIfMissing(tx, {productId, batchNumber, mfgDate, expiryDate, costPrice, purchaseId}) → Batch
await applyStockMovement(tx, {...})                      // StockItem را اتمیک به‌روز و حرکت را ثبت می‌کند؛ OUT/TRANSFER موجودی را اعتبارسنجی می‌کند
await recalcCustomerBalance(tx, customerId)              // = Σ فروش‌های تأییدشده (totalAfn − returnedAfn − paidAmount... با بازگشت‌ها)
await recalcSupplierBalance(tx, supplierId)
await recalcSaleStatus(tx, saleId) / recalcPurchaseStatus(tx, id)   // COMPLETED وقتی کامل پرداخت شد
await logAudit(tx, {userId, userName, branchId, action, entity, entityId, summary, before?, after?, ip?})
computeEffectiveCost(lineTotalAfn, quantity, freeQuantity)           // بهای مؤثر = مبلغ پرداختی ÷ کل مقدار دریافتی
allocExtraCost(extraCostAfn, [{lineNet}], basis "VALUE"|"QTY") → number[]
getSetting(key, def?) / setSetting(key, value)
```

## 4. احراز هویت و صلاحیت‌ها (`src/lib/auth.ts`)

```ts
await getSessionUser() → AuthUser|null            // بدون خطا
await requireUser() → AuthUser                     // 401 اگر نبود
requirePermission(user, "sales.create")            // 403
hasPermission(user, "sales.view") → boolean        // role SUPER_ADMIN یا permissions شامل "*" همه‌چیز
assertBranchAccess(user, branchId)                 // 403 اگر کاربر شعبه‌دار و شعبه متفاوت
allowedBranchIds(user) → string[]|undefined        // undefined = همه (سوپرادمین)
hashPassword / verifyPassword
```
کوکی سشن: `pharma_session` (httpOnly, 30 روز). فرانت بعد از login کاربر را از `GET /api/auth/me` می‌گیرد:
```json
{ "user": { "id","username","fullName","roleKey","roleName","permissions":["*"]|["sales.view",...],"branchId","branchName","isSuperAdmin" } }
```

## 5. کاتالوگ صلاحیت‌ها (`src/lib/permissions.ts`)

ماژول‌ها: dashboard, purchases, sales, customers, suppliers, payments, returns, products, inventory, batches, personnel, expenses, partnerships, currency, reports, admin, audit, backup, settings
اکشن‌ها: view, create, edit, delete, approve → مثال: `purchases.approve`. برای داشبورد فقط `dashboard.view`.

## 6. قرارداد endpointها (بدنه‌ها با JSON)

### auth (2-a)
- `POST /api/auth/login {username,password}` → `{user}` + کوکی؛ Audit LOGIN. ورود کاربر غیرفعال ممنوع.
- `POST /api/auth/logout` → Audit LOGOUT.
- `GET /api/auth/me` → `{user}` یا `{user:null}` (هرگز 401 ندهد).
- `GET /api/auth/bootstrap-status` → `{hasUsers, defaultHint?}` — اگر setup تازه اجرا شده `defaultHint:"admin/admin123"`.
- `POST /api/setup` → اجرای bootstrap اولیه (شرکت، رول‌ها، شعبه دفتر مرکزی کابل، گدام اصلی، کاربر admin، تنظیمات پیش‌فرض، اسعار اولیه دستی).

### branches (2-a) — مدیریت فقط admin
- `GET /api/branches` → همه (برای منوها؛ کاربر عادی فقط نام‌ها لازم ندارد چون شعبه خودش در /me است — ولی خواندن لیست برای سوئیچ نمایش آزاد است)
- `POST {code,name,city?,address?,phone?,isHeadOffice?}` / `PUT /[id]` / `DELETE /[id]` (اگر داده دارد → `isActive:false` و پیام)

### users (2-a) — admin
- `GET /api/users?branchId?&q?` (غیر admin فقط شعبه خودش)
- `POST {username,password,fullName,phone?,roleId,branchId,isActive?}` — branchId برای غیرسوپرادمین نادیده و = user.branchId
- `PUT /[id] {fullName?,phone?,roleId?,branchId?,isActive?,password?}` / `DELETE /[id]` (deactivate)

### roles (2-a)
- `GET /api/roles` (هر کاربر وارد — برای دراپ‌داون) / `POST {name,key,permissions[]}` / `PUT /[id]` / `DELETE /[id]` (isSystem یا دارای کاربر → خطا)

### warehouses / territories / salespersons (2-a) — personnel.view ویرایش با personnel.create/edit/delete
- `GET/POST/PUT/DELETE /api/warehouses` (`{branchId,name,location?,isMain?}`) — حذف با موجودی ممنوع
- `GET/POST/PUT/DELETE /api/territories` (`{branchId,name,description?}`)
- `GET/POST/PUT/DELETE /api/salespersons` (`{branchId,name,phone?,commission,territoryIds:[],userId?}`) — m2m territories

### settings (2-a)
- `GET /api/settings` → همه کلیدها + `company_name,company_address,company_phone,invoice_footer_note,require_approval_purchases,require_approval_sales,require_approval_expenses,require_approval_returns,block_expired_sales,allow_negative_stock,expiry_warn_days,profit_distribution_base,default_currency,invoice_template_default,seq_prefix_PURCHASE/SALE/PAYMENT/PURCHASE_RETURN/SALES_RETURN`
- `PUT /api/settings {key:value,...}` — بولین‌ها به "true"/"false" string ذخیره؛ `getSetting` helper parse می‌کند.

### audit (2-a)
- `GET /api/audit?q?&action?&branchId?&from?&to?&page?&limit?` → `{items,total,page,limit}` (audit.view، فیلتر شعبه برای غیرسوپرادمین)

### backups (2-a) — backup.view/create/delete
- `GET /api/backups` / `POST /api/backups {note?}` (کپی فایل sqlite به `db/backups/`، رکورد Backup) / `POST /api/backups/[id]/restore {confirm:true}` (بازیابی با PrismaClient دوم به فایل بک‌آپ و کپی جدول‌ها داخل تراکنش + Audit RESTORE) / `DELETE /api/backups/[id]` (حذف فایل+رکورد)

### search / notifications (2-a)
- `GET /api/search?q=` → `{products[],batches[],customers[],suppliers[],sales[],purchases[],payments[]}` (هر کدام حداکثر 5، فیلتر شعبه/صلاحیت)
- `GET /api/notifications` → `{items:[{type,severity,title,message,count?,viewId?}], unreadStored:[...] }` شامل: بچ‌های در حال انقضا (پیش‌فرض ۹۰ روز از setting)، منقضی‌ها، کمبود موجودی (زیر minStock)، مشتریان بالای سقف اعتبار، در انتظار تصویب (خرید/فروش/برگشتی/مصارف PENDING)، آخرین به‌روزرسانی نرخ اسعار قدیمی (>2 برابر refreshMinutes)، همگام‌سازی ناموفق اخیر. فیلتر شعبه رعایت شود.

### sync (2-a)
- `POST /api/sync/push {deviceId, items:[{localId, path, payload, queuedAt}]}` — whitelist فقط: `/api/purchases`,`/api/sales`,`/api/payments`,`/api/expenses`,`/api/customers`. برای هر آیتم: اگر localId موجود → `DUPLICATE`؛ اجرای همان منطق ایجاد endpoint مربوط (فراخوانی تابع مشترک از همان lib یا replay داخلی)؛ خطای موجودی → `CONFLICT`؛ موفق → `SYNCED` با `data.id`. همه در `SyncLog` ثبت شود.
- `GET /api/sync/logs?limit=50` → آخرین نتایج (برای نمایش در UI)

### products / categories / manufacturers (2-b) — products.view/create/edit/delete
- `GET /api/products?q?&categoryId?&manufacturerId?&includeInactive?&page?&limit?` → `{items,total}` (هر item شامل موجودی کل `stockTotal`)
- `POST /api/products {...}` / `PUT /[id]` / `DELETE /[id]` (اگر بچ/فروش دارد → deactivate)
- `GET/POST /api/categories` `GET/POST /api/manufacturers` (+PUT/DELETE)

### batches (2-b) — batches.view
- `GET /api/batches?q?&productId?&status?&warehouseId?&expiryWithinDays?` → با مجموع موجودی هر بچ + وضعیت محاسبه‌شده VALID|EXPIRING_SOON|EXPIRED (آستانه از setting)
- `GET /api/batches/[id]/trace` → `{batch,product,purchase:{...supplier,date},movements[],sales[{invoice,date,customer,quantity,freeQuantity}],currentStock[{warehouse,quantity}]}` — ردیابی کامل بچ

### stock (2-b) — inventory.view/edit
- `GET /api/stock?warehouseId?&productId?&q?&belowMin?&expiringDays?` → آیتم‌های موجودی با product/batch
- `GET /api/stock/movements?productId?&batchId?&warehouseId?&type?&from?&to?&page?`
- `POST /api/stock/transfers {fromWarehouseId,toWarehouseId,reason?,lines:[{productId,batchId,quantity}]}` — هر دو گدام باید در شعبه مجاز کاربر باشند؛ با applyStockMovement
- `POST /api/stock/adjustments {warehouseId,lines:[{productId,batchId,newQuantity,reason,type? DAMAGE|EXPIRED|ADJUSTMENT}]}` — دلتا محاسبه و ثبت

### purchases (2-c) — purchases.view/create/edit/approve
- `GET /api/purchases?q?&status?&supplierId?&branchId?&dateFrom?&dateTo?&page?&limit?` → `{items,total}`
- `GET /api/purchases/[id]` → با items+supplier+warehouse+payments+returns
- `POST /api/purchases {supplierId,warehouseId,type,date,currency,exchangeRate,extraCost?,extraCostBasis? "VALUE"|"QTY",notes?,items:[{productId,batchNumber,mfgDate?,expiryDate?,quantity,freeQuantity,unitPrice,discountPct?,discountAmount?,promotionNote?}],paidAmount?,paymentMethod?,status? "DRAFT"|"PENDING"|"APPROVED",localId?}`
  - محاسبات: `netUnitPrice = unitPrice×(1−discountPct/100) − (discountAmount||0)/quantity`؛ `lineTotal = quantity×netUnitPrice`؛ `subtotal=Σ lineTotal`؛ `total = subtotal + extraCost`؛ همه نرخ×exchangeRate به `Afn` تبدیل و round2 شود.
  - `effectiveCost` هر قلم = `round2((lineTotalAfn + extraCostTAlloc)/(quantity+freeQuantity))` — تعداد مجانی موجودی را زیاد می‌کند ولی در مبلغ مؤثر تقسیم می‌شود.
  - اگر status=APROVED (یا require_approval_purchases=false → مستقیم APPROVED): در تراکنش → createBatchIfMissing (costPrice=effectiveCost) → applyStockMovement IN به گدام → ثبت Payment اگر paidAmount>0 → recalcSupplierBalance → recalcPurchaseStatus (COMPLETED اگر پرداخت کامل) → Audit.
  - validation: تأمین‌کننده/گدام معتبر و در شعبه مجاز؛ هر قلم quantity>0؛ batchNumber الزامی (اگر خالی «بدون-بچ»).
- `PUT /api/purchases/[id]` فقط DRAFT (بازمحاسبه کامل)؛ `POST /api/purchases/[id]/approve` / `POST /api/purchases/[id]/cancel` (فقط DRAFT/PENDING؛ APPROVED باید با برگشتی مدیریت شود)

### sales (2-c) — sales.view/create/edit/approve
- `GET/GET[id]/POST/PUT/[id]/approve/cancel` مشابه خرید با تفاوت‌ها:
  - items: `{productId,batchId,quantity,freeQuantity,unitPrice,discountPct?,discountAmount?,promotionNote?}` — batchId الزامی.
  - اعتبارسنجی موجودی: `quantity+freeQuantity ≤ StockItem` مگر `allow_negative_stock=true`؛ بچ منقضی ممنوع اگر `block_expired_sales=true` (expiring_soon فقط هشدار در response `{warnings:[...]}`).
  - سقف اعتبار: اگر `creditLimit>0` و `(customer.balance + remainingAfn) > creditLimit` → 403 با پیام دری.
  - `costAtSale = batch.costPrice` ذخیره شود (بهای تمام‌شده تاریخی).
  - به مشتری balance اضافه/پرداخت کم؛ territoryId/salespersonId اگر customer دارای باشد و کاربر تعیین نکرده، از مشتری برداشته شود.

### payments (2-c) — payments.view/create/delete
- `GET /api/payments?type?&customerId?&supplierId?&saleId?&purchaseId?&branchId?&from?&to?&page?`
- `POST /api/payments {type CUSTOMER|SUPPLIER,customerId?/supplierId?,saleId?/purchaseId?,amount,currency,exchangeRate?,method,reference?,date,notes?,localId?}` → شماره رسید PAY-...؛ IN: customer.balance کاهش؛ OUT: supplier.balance کاهش؛ اگر به فاکتور لینک شد paidAmount += amount و recalc status؛ مبلغ بیشتر از باقی‌مانده = پیش‌پرداخت (مجاز، در پاسخ هشدار). Audit PAYMENT.
- `DELETE /api/payments/[id]` → CANCELLED + معکوس‌سازی کامل اثر (balance، paidAmount، status فاکتور) — فقط payments.delete + audit.

### returns (2-c) — returns.view/create/approve
- `GET /api/returns?type SALES|PURCHASE&...&page?`
- `POST /api/returns/sales {saleId,reason?,items:[{saleItemId,quantity}]}` — quantity ≤ quantity اصل منهای قبلاً برگشتی؛ totalAfn = Σ unitPriceAfn(نت)×qty؛ روی Approve: RETURN_IN به گدام فاکتور، customer.balance −= totalAfn، sale.returnedAfn += totalAfn، Audit.
- `POST /api/returns/purchases {purchaseId,items:[{purchaseItemId,quantity}]}` → روی Approve: OUT از گدام، supplier.balance −= totalAfn، purchase.returnedAfn += totalAfn.
- `POST /api/returns/[type]/[id]/approve` و `/cancel` (فقط REQUESTED→approve/cancel) — تصویب برگشتی نیازمند returns.approve؛ اگر require_approval_returns=false → مستقیم APPROVED هنگام ایجاد.

### customers (2-c) — customers.view/create/edit/delete
- `GET /api/customers?q?&type?&territoryId?&salespersonId?&page?&limit?` (فیلتر شعبه)
- `GET /api/customers/[id]` → `{customer, sales[], payments[], returns[]}` (صورت‌حساب)
- `POST {name,type,phone?,address?,territoryId?,salespersonId?,creditLimit?,paymentTerms?,localId?}` branchId خودکار
- `PUT/[id]` / `DELETE/[id]` (دارای تراکنش → deactivate)

### suppliers (2-c) — suppliers.view/create/edit/delete
- `GET /api/suppliers?q?&type?` (سراسری) / `POST {name,type,country?,phone?,email?,address?,contactPerson?}` / `PUT/[id]` / `DELETE/[id]` (دارای خرید → deactivate)

### expenses (2-d) — expenses.view/create/edit/approve
- `GET /api/expenses?branchId?&categoryId?&status?&from?&to?&page?`
- `POST {categoryId,amount,currency,exchangeRate?,date,description?,localId?}` — branchId خودکار؛ status=PENDING یا APPROVED اگر require_approval_expenses=false
- `PUT/[id]` (فقط PENDING) / `POST /[id]/approve` / `POST /[id]/cancel` (فقط PENDING) / `POST /[id]/mark-paid` (APPROVED→PAID)
- `GET/POST/PUT/DELETE /api/expense-categories`

### partners & partnerships (2-d) — partnerships.view/create/edit/delete
- `GET/POST/PUT /api/partners`
- `GET /api/partnerships?branchId?&status?&type?` / `POST {branchId?,partnerId,type,role?,capital,profitSharePct,lossSharePct,profitMethod?,startDate,endDate?,terms?}` — اعتبارسنجی: Σ سهم EQUITYهای فعالِ یک شعبه ≤ 100؛ مضاربه جدا از شراکت سهامی است (type جداد)
- `PUT/[id]` / `POST /[id]/end`
- `GET /api/partnerships/distributions?partnershipId?&branchId?&from?&to?`
- `POST /api/partnerships/distributions/calculate {branchId,dateFrom,dateTo}` → محاسبه مالی دورهٔ شعبه (عواید، COGS با costAtSale، ناخالص، مصارف تأییدشده، خالص) → پایه توزیع از setting `profit_distribution_base` (NET_PROFIT|GROSS_PROFIT|REVENUE) → برای هر شراکت فعال ردیف ProfitDistribution با سهم = base×pct/100 (سوپرادمین/مدیر)
- `POST /api/partnerships/distributions/[id]/approve` (CALCULATED→APPROVED)

### exchange-rates (2-d) — currency.view/edit
- `GET /api/exchange-rates?limit=50` → `{latest:[{base,quote,buyRate,sellRate,source,createdAt,isOffline}], history:[...]}`
- `POST /api/exchange-rates {source:"API"}` → fetch از CurrencySettings.endpoint (server-side fetch با timeout 8s)، mapping JSON (پیش‌فرض USD→AFN/PKR از `rates`)، درج رکورد؛ شکست → ok:false با پیام + نگه‌داشتن lastSyncError
- `POST /api/exchange-rates {source:"MANUAL", rates:[{base,quote,buyRate,sellRate}]}` — ثبت با نام کاربر
- `GET/PUT /api/exchange-rates/settings {apiEndpoint,apiKey?,refreshMinutes,mapping,enabled}`
- `GET /api/exchange-rates/latest?base=USD` → برای پرکردن خودکار نرخ در فرم خرید/فروش (اگر API تازه نبود، آخرین نرخ ذخیره با `isOffline:true`)

### reports (2-d) — reports.view؛ همه با فیلترهای `from,to,branchId(فقط سوپرادمین),...` و خروجی آرایه ردیف‌های ساده برای DataTable
- `GET /api/reports/sales?groupBy=day|month|branch|customer|salesperson|territory|product|batch&filters` → rows `[{key,label,count,quantity?,totalAfn,costAfn?,profitAfn?}]`
- `GET /api/reports/purchases?groupBy=day|month|branch|supplier|product|batch`
- `GET /api/reports/inventory?type=current|valuation|batch|expiry|low|movement&...`
- `GET /api/reports/financial?from&to&branchId?` → `{revenueAfn,salesReturnsAfn,netRevenueAfn,cogsAfn,grossProfitAfn,expensesAfn,netProfitAfn,receivablesAfn,payablesAfn,inventoryValueAfn}`
- `GET /api/reports/currency?limit=`
- فرمول‌ها: عواید = Σ فروش APPROVED/COMPLETED (totalAfn − returnedAfn)؛ COGS = Σ (costAtSale×(quantity+freeQuantity)) − برگشتی خرید مرتبط؛ به همین ترتیب ناخالص/خالص. **هرگز مصارف را از ناخالص دوباره کم نکن مگر در netProfit.**

### dashboard (2-d) — dashboard.view
- `GET /api/dashboard` → بر اساس نقش:
  - سوپرادمین: `{branchCount,salesTodayAfn,salesMonthAfn,purchasesMonthAfn,receivablesAfn,payablesAfn,inventoryValueAfn,grossProfitMonthAfn,netProfitMonthAfn,expiringBatches,lowStockCount,recent:[...10],branchPerformance:[{branchId,branchName,salesAfn,purchasesAfn,expensesAfn,netProfitAfn}]}`
  - مدیر شعبه/کاربر: همان‌ها فقط شعبه خودش + `salespersonPerformance` + `territoryPerformance`

## 8. قرارداد سرویس‌های داخلی برای همگام‌سازی (2-c موظف به ساخت، 2-a موظف به استفاده)

ایجنت 2-c باید منطق ایجاد رکوردها را در فایل‌های سرویس زیر export کند تا `/api/sync/push` (ایجنت 2-a) بدون HTTP داخلی آن‌ها را فراخوانی کند:

```ts
// src/app/api/purchases/_service.ts
import type { AuthUser } from "@/lib/auth";
export async function createPurchase(user: AuthUser, body: Record<string, unknown>, ip?: string): Promise<unknown>;
// src/app/api/sales/_service.ts → createSale(user, body, ip?)
// src/app/api/payments/_service.ts → createPayment(user, body, ip?)
// src/app/api/expenses/_service.ts → createExpense(user, body, ip?)
// src/app/api/customers/_service.ts → createCustomer(user, body, ip?)
```

- route.ts همان فولدر فقط یک wrapper نازک است: `const user = await requireUser(); ... createPurchase(user, await req.json(), ip)`.
- این توابع خطای `ApiError` پرتاب می‌کنند؛ sync push آن‌ها را می‌گیرد و به CONFLICT (کد INSUFFICIENT_STOCK یا پیام تعارض) یا FAILED تبدیل می‌کند.
- اگر `body.localId` تکراری باشد تابع باید رکورد موجود را برگرداند (idempotent).

ایجنت 2-a در `/api/sync/push` این نقشه را دارد:
```ts
const HANDLERS: Record<string, (u: AuthUser, b: Record<string, unknown>, ip?: string) => Promise<unknown>> = {
  "/api/purchases": createPurchase,
  "/api/sales": createSale,
  "/api/payments": createPayment,
  "/api/expenses": createExpense,
  "/api/customers": createCustomer,
};
```
برای هر آیتم: try handler → SyncLog SYNCED؛ خطای ApiError با code=INSUFFICIENT_STOCK → CONFLICT؛ سایر خطاها → FAILED. اگر localId قبلاً در SyncLog با SYNCED/DUPLICATE برای همین entityType باشد → DUPLICATE.

## 9. نکات محاسباتی الزامی

- همه مبالغ `amount` در Payment همیشه به **افغانی** است؛ اگر کاربر با USD/PKR پرداخت کند، مبلغ افغانی = مقدار×نرخ و currency/exchangeRate برای مرجع ذخیره می‌شود.
- `Purchase.total = subtotal + extraCost` (واحد سند)؛ `totalAfn = total × exchangeRate`؛ قلم‌ها: `lineTotalAfn = lineTotal × exchangeRate`؛ `effectiveCost = (lineTotalAfn + سهم مصارف اضافی) ÷ (quantity + freeQuantity)`.
- `SaleItem.costAtSale` هنگام تأیید فروش از `batch.costPrice` ذخیره می‌شود — هرگز بعداً تغییر نکن.
- تاریخ‌های ورودی فرم‌ها هجری شمسی‌اند (`1404/03/12`)؛ کلاینت با `hijriInputToDate` به Date تبدیل و ISO می‌فرستد.
- گروه‌بندی روزانه راپورها با تاریخ کابل: `new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kabul" }).format(d)` → YYYY-MM-DD.
- داشبورد "این ماه" = ۳۰ روز اخیر (Kabul).

## 10. لینت و تست

- پایان کار: `bun run lint` اجرا و **خطاهای فایل‌های خودت** را صفر کن؛ خطای فایل‌های ایجنت‌های دیگر را نادیده بگیر و دست نزن.
- سرور dev از قبل روی 3000 در حال اجراست — آن را استارت/ریستارت نکن.
- ثبت کار: در پایان با bash append به `/home/z/my-project/worklog.md` (heredoc، بخش با `---`).

## 7. قرارداد فرانت (ویوها — `src/components/views/*.tsx`)

- هر ویو: `export default function XView()`، `'use client'`، بدون props (از `useUser()` استفاده کن: `{user, hasPermission}` از `@/components/shared/use-user`؛ بخش‌های دارای صلاحیت با `<PermissionGate permission="...">` بپوشان).
- داده: `const {data, loading, error, refetch} = useApiData<T>(path|null, deps)`.
- ارسال: `const res = await apiSend<T>(path, {method:"POST", body: JSON.stringify(...)})` — در صورت `res.queued` یعنی آفلاین ذخیره شد → toast «به‌صورت آفلاین ذخیره شد؛ پس از اتصال همگام می‌شود» و لیست را refetch نکن.
- خطاها: `toast.error(err.message)` (sonner). موفق: `toast.success(...)`.
- اعداد: `formatMoney(n, currency)`؛ تاریخ‌ها `formatHijriDateTime/formatHijriDate/formatHijriShort`؛ ورودی تاریخ فرم: `dateToHijriInput` و `hijriInputToDate` از `@/lib/format` و `@/lib/hijri`.
- برچسب وضعیت‌ها از `@/lib/terminology` + `<StatusBadge status=... />` (و `BatchStatusBadge`, `MovementBadge`).
- جدول‌ها با `<DataTable columns rows searchKeys loading />` (جستجو/سورت/صفحه‌بندی/اسکرول).
- فرم‌ها داخل `<FormDialog>`؛ حذف‌ها با `<ConfirmDialog>`؛ هدر با `<PageHeader title description actions>`.
- چاپ اسناد: `<PrintDialog doc={...} onOpenChange={...}/>` + helperهای `saleToPrintDoc`, `purchaseToPrintDoc`, `paymentToPrintDoc` از `@/components/shared/print-invoice` (دو تمپلیت SIMPLE/DETAILED + رسید پرداخت؛ شرکت نام/یادداشت فوتر را از `/api/settings` بگیر).
- استایل: RTL، شعبه فعلی در هدر، رنگ‌ها emerald/amber/rose/slate (بدون آبی/indigo)، ریسپانسیو (موبایل-first)، جدول‌ها `max-h-96 overflow-y-auto`.
- دسترسی: اگر `!hasPermission("x.view")` → پیام «شما صلاحیت دسترسی به این بخش را ندارید».
