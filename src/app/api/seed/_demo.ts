import { randomUUID } from "crypto";
import type { Customer, Prisma, Salesperson, Territory } from "@prisma/client";
import { ApiError, round2 } from "@/lib/api-utils";
import type { Tx } from "@/lib/auth";
import {
  allocExtraCost,
  applyStockMovement,
  computeEffectiveCost,
  createBatchIfMissing,
  logAudit,
  nextDocNumber,
  recalcCustomerBalance,
  recalcPurchaseStatus,
  recalcSaleStatus,
  recalcSupplierBalance,
} from "@/lib/business";

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);
const daysAhead = (n: number) => new Date(Date.now() + n * DAY);

type DemoProductDef = {
  name: string;
  genericName: string;
  category: string | null;
  manufacturer: string;
  dosageForm: string;
  strength: string;
  unit: string;
  packaging: string;
  purchasePrice: number;
  salePrice: number;
  minStock: number;
  maxStock: number;
};

type DemoPurchaseLine = {
  productName: string;
  batchNumber: string;
  quantity: number;
  freeQuantity: number;
  unitPrice: number;
  discountPct: number;
  mfgDaysAgo: number;
  expiryDaysAhead: number;
};

type DemoSaleLine = {
  productName: string;
  batchNumber: string;
  quantity: number;
  unitPrice: number;
};

export type DemoSeedCounts = {
  branches: number;
  warehouses: number;
  territories: number;
  salespersons: number;
  categories: number;
  manufacturers: number;
  products: number;
  suppliers: number;
  customers: number;
  purchases: number;
  sales: number;
  payments: number;
  expenses: number;
};

export type SeedActor = { id: string; fullName: string; branchId: string | null };

/**
 * اجرای کامل بارگذاری داده‌های نمایشی داخل تراکنش — از /api/seed فراخوانی می‌شود.
 * در transaction واقعی پیچیده می‌شود تا هر خطا باعث rollback کامل شود.
 */
export async function runDemoSeed(tx: Tx, user: SeedActor): Promise<DemoSeedCounts> {
      // ─────────────── شعبه‌ها و گدام اصلی ───────────────
      const branchDefs = [
        { code: "MZR", name: "شعبه مزار شریف", city: "مزار شریف" },
        { code: "HER", name: "شعبه هرات", city: "هرات" },
        { code: "KDR", name: "شعبه قندهار", city: "قندهار" },
      ];
      const branches: Record<string, { id: string; mainWarehouseId: string }> = {};
      for (const def of branchDefs) {
        const branch = await tx.branch.create({
          data: { ...def, isActive: true },
        });
        const wh = await tx.warehouse.create({
          data: { branchId: branch.id, name: "گدام اصلی", isMain: true },
        });
        branches[def.code] = { id: branch.id, mainWarehouseId: wh.id };
      }
      const mzr = branches["MZR"];

      // ─────────────── مناطق فروش MZR ───────────────
      const territoryNames = ["منطقه اول", "منطقه دوم", "منطقه سوم"];
      const territoryRows: Territory[] = [];
      for (const name of territoryNames) {
        territoryRows.push(
          await tx.territory.create({ data: { branchId: mzr.id, name } })
        );
      }

      // ─────────────── فروشندگان MZR ───────────────
      const salespersonDefs = [
        { name: "احمدجان صدیقی", phone: "0700 111 222", commission: 2 },
        { name: "عبدالوهاب رحیمی", phone: "0700 333 444", commission: 2.5 },
        { name: "شفیق نوری", phone: "0700 555 666", commission: 1.5 },
      ];
      const salespersonRows: Salesperson[] = [];
      for (let i = 0; i < salespersonDefs.length; i++) {
        const def = salespersonDefs[i];
        const sp = await tx.salesperson.create({
          data: {
            branchId: mzr.id,
            name: def.name,
            phone: def.phone,
            commission: def.commission,
            territories: { connect: { id: territoryRows[i].id } },
          },
        });
        salespersonRows.push(sp);
      }

      // ─────────────── کتگوری‌ها و تولیدکنندگان ───────────────
      const categoryNames = [
        "انتی‌بیوتیک",
        "مسکنات",
        "ویتامین",
        "ضداسید",
        "ضدملاریا",
        "سرم و انفوزیون",
      ];
      const categoryIds: Record<string, string> = {};
      for (const name of categoryNames) {
        const c = await tx.category.create({ data: { name } });
        categoryIds[name] = c.id;
      }

      const manufacturerNames = ["Hilton Pharma", "Sami Pharma", "Sanofi", "GSK", "Abbott"];
      const manufacturerIds: Record<string, string> = {};
      for (const name of manufacturerNames) {
        const m = await tx.manufacturer.create({ data: { name } });
        manufacturerIds[name] = m.id;
      }

      // ─────────────── محصولات (۱۲ قلم) ───────────────
      const productDefs: DemoProductDef[] = [
        { name: "پاراسیتامول تبلت 500mg", genericName: "Paracetamol", category: "مسکنات", manufacturer: "Hilton Pharma", dosageForm: "تبلت", strength: "500mg", unit: "عدد", packaging: "بکس 100×10", purchasePrice: 1.3, salePrice: 1.8, minStock: 1000, maxStock: 20000 },
        { name: "اموکسی‌سلین کپسول 500mg", genericName: "Amoxicillin", category: "انتی‌بیوتیک", manufacturer: "Sami Pharma", dosageForm: "کپسول", strength: "500mg", unit: "عدد", packaging: "بکس 100×10", purchasePrice: 3.2, salePrice: 3.9, minStock: 800, maxStock: 15000 },
        { name: "ایبوپروفین تبلت 400mg", genericName: "Ibuprofen", category: "مسکنات", manufacturer: "Abbott", dosageForm: "تبلت", strength: "400mg", unit: "عدد", packaging: "بکس 100×10", purchasePrice: 1.6, salePrice: 2.4, minStock: 600, maxStock: 12000 },
        { name: "ویتامین C 1000mg", genericName: "Ascorbic Acid", category: "ویتامین", manufacturer: "Hilton Pharma", dosageForm: "تبلت", strength: "1000mg", unit: "عدد", packaging: "بکس 50×10", purchasePrice: 2, salePrice: 3.5, minStock: 500, maxStock: 10000 },
        { name: "اومپرازول کپسول 20mg", genericName: "Omeprazole", category: "ضداسید", manufacturer: "Sami Pharma", dosageForm: "کپسول", strength: "20mg", unit: "عدد", packaging: "بکس 100×10", purchasePrice: 2.4, salePrice: 3.6, minStock: 600, maxStock: 12000 },
        { name: "سرم نرمال سالین 500ml", genericName: "Sodium Chloride 0.9%", category: "سرم و انفوزیون", manufacturer: "Abbott", dosageForm: "سرم", strength: "0.9%", unit: "بوتل", packaging: "کارتن 20", purchasePrice: 18, salePrice: 30, minStock: 200, maxStock: 5000 },
        { name: "آرتمیتر/لومیفانترین تبلت", genericName: "Artemether/Lumefantrine", category: "ضدملاریا", manufacturer: "Sanofi", dosageForm: "تبلت", strength: "20/120mg", unit: "عدد", packaging: "بکس 60×6", purchasePrice: 4.7, salePrice: 8, minStock: 300, maxStock: 6000 },
        { name: "متفورمین تبلت 500mg", genericName: "Metformin", category: null, manufacturer: "Sami Pharma", dosageForm: "تبلت", strength: "500mg", unit: "عدد", packaging: "بکس 100×10", purchasePrice: 1.2, salePrice: 1.9, minStock: 500, maxStock: 10000 },
        { name: "آزیترومایسین تبلت 250mg", genericName: "Azithromycin", category: "انتی‌بیوتیک", manufacturer: "GSK", dosageForm: "تبلت", strength: "250mg", unit: "عدد", packaging: "بکس 30×6", purchasePrice: 5.1, salePrice: 9, minStock: 300, maxStock: 6000 },
        { name: "دیکوفناک ژل 50mg", genericName: "Diclofenac Sodium", category: "مسکنات", manufacturer: "Abbott", dosageForm: "ژل", strength: "1%", unit: "تیوب", packaging: "کارتن 50", purchasePrice: 55, salePrice: 85, minStock: 100, maxStock: 2000 },
        { name: "سیتریزین تبلت 10mg", genericName: "Cetirizine", category: null, manufacturer: "Hilton Pharma", dosageForm: "تبلت", strength: "10mg", unit: "عدد", packaging: "بکس 100×10", purchasePrice: 0.7, salePrice: 1.2, minStock: 600, maxStock: 12000 },
        { name: "اورسرم اورال", genericName: "Oral Rehydration Salts", category: "سرم و انفوزیون", manufacturer: "Sami Pharma", dosageForm: "پودر", strength: "20.5g", unit: "پاکت", packaging: "کارتن 100", purchasePrice: 0.36, salePrice: 1, minStock: 1000, maxStock: 30000 },
      ];
      const productIds: Record<string, string> = {};
      for (const p of productDefs) {
        const created = await tx.product.create({
          data: {
            name: p.name,
            genericName: p.genericName,
            categoryId: p.category ? categoryIds[p.category] : undefined,
            manufacturerId: manufacturerIds[p.manufacturer],
            dosageForm: p.dosageForm,
            strength: p.strength,
            unit: p.unit,
            packaging: p.packaging,
            storeCondition: "در جای خشک و خنک و دور از نور مستقیم نگهداری شود",
            purchasePrice: p.purchasePrice,
            salePrice: p.salePrice,
            minStock: p.minStock,
            maxStock: p.maxStock,
          },
        });
        productIds[p.name] = created.id;
      }

      // ─────────────── تأمین‌کنندگان ───────────────
      const supSahara = await tx.supplier.create({
        data: {
          type: "FOREIGN",
          name: "شرکت وارداتی صحرا",
          country: "امارات",
          phone: "+971 4 000 0000",
          address: "دبی، امارات متحده عربی",
        },
      });
      await tx.supplier.create({
        data: { type: "LOCAL", name: "کمپانی طبابی کابل", country: "افغانستان", phone: "0700 777 888", address: "کابل، شهر نو" },
      });
      await tx.supplier.create({
        data: { type: "FOREIGN", name: "پاک‌فارما", country: "پاکستان", phone: "+92 42 000 0000", address: "لاهور، پاکستان" },
      });

      // ─────────────── مشتریان MZR (۸) ───────────────
      const customerDefs = [
        { name: "فارمسی شب‌زنده‌دار", type: "PHARMACY", t: 0, sp: 0, creditLimit: 50000, paymentTerms: 15 },
        { name: "فارمسی شفا", type: "PHARMACY", t: 0, sp: 0, creditLimit: 30000, paymentTerms: 10 },
        { name: "شفاخانه ابوذر", type: "HOSPITAL", t: 1, sp: 1, creditLimit: 120000, paymentTerms: 30 },
        { name: "کلینیک سلامت", type: "CLINIC", t: 1, sp: 1, creditLimit: 60000, paymentTerms: 20 },
        { name: "فارمسی نجات", type: "PHARMACY", t: 2, sp: 2, creditLimit: 40000, paymentTerms: 15 },
        { name: "داروخانه مرکزی بلخ", type: "PHARMACY", t: 2, sp: 2, creditLimit: 80000, paymentTerms: 25 },
        { name: "شفاخانه ولایتی", type: "HOSPITAL", t: 0, sp: 1, creditLimit: 100000, paymentTerms: 30 },
        { name: "فارمسی عافیت", type: "PHARMACY", t: 1, sp: 0, creditLimit: 25000, paymentTerms: 10 },
      ];
      const customerRows: Customer[] = [];
      for (const c of customerDefs) {
        customerRows.push(
          await tx.customer.create({
            data: {
              branchId: mzr.id,
              type: c.type,
              name: c.name,
              territoryId: territoryRows[c.t].id,
              salespersonId: salespersonRows[c.sp].id,
              creditLimit: c.creditLimit,
              paymentTerms: c.paymentTerms,
              phone: "0700 000 000",
            },
          })
        );
      }

      // ─────────────── خرید وارداتی APPROVED از صحرا ───────────────
      const rate = 72;
      const extraCost = 100; // USD (ترانسپورت و گمرک)
      const purchaseLines: DemoPurchaseLine[] = [
        { productName: "پاراسیتامول تبلت 500mg", batchNumber: "B-2401", quantity: 10000, freeQuantity: 1000, unitPrice: 0.018, discountPct: 0, mfgDaysAgo: 150, expiryDaysAhead: 380 },
        { productName: "اموکسی‌سلین کپسول 500mg", batchNumber: "B-2402", quantity: 5000, freeQuantity: 250, unitPrice: 0.045, discountPct: 2, mfgDaysAgo: 120, expiryDaysAhead: 400 },
        { productName: "ویتامین C 1000mg", batchNumber: "B-2403", quantity: 3000, freeQuantity: 300, unitPrice: 0.03, discountPct: 0, mfgDaysAgo: 200, expiryDaysAhead: 330 },
        { productName: "سرم نرمال سالین 500ml", batchNumber: "B-2404", quantity: 2000, freeQuantity: 0, unitPrice: 0.25, discountPct: 0, mfgDaysAgo: 90, expiryDaysAhead: 540 },
        { productName: "آرتمیتر/لومیفانترین تبلت", batchNumber: "B-2405", quantity: 2000, freeQuantity: 100, unitPrice: 0.065, discountPct: 0, mfgDaysAgo: 180, expiryDaysAhead: 500 },
        { productName: "آزیترومایسین تبلت 250mg", batchNumber: "B-2406", quantity: 1500, freeQuantity: 75, unitPrice: 0.07, discountPct: 0, mfgDaysAgo: 160, expiryDaysAhead: 450 },
        { productName: "اورسرم اورال", batchNumber: "B-2407", quantity: 10000, freeQuantity: 500, unitPrice: 0.005, discountPct: 0, mfgDaysAgo: 100, expiryDaysAhead: 600 },
      ];

      let subtotal = 0;
      let discountTotal = 0;
      const computed = purchaseLines.map((l) => {
        const netUnitPrice = round2(
          l.unitPrice * (1 - l.discountPct / 100) - 0 / l.quantity
        );
        const lineTotal = round2(l.quantity * netUnitPrice);
        subtotal += lineTotal;
        discountTotal += round2((l.unitPrice - netUnitPrice) * l.quantity);
        return { ...l, netUnitPrice, lineTotal };
      });
      subtotal = round2(subtotal);
      discountTotal = round2(discountTotal);
      const total = round2(subtotal + extraCost);
      const totalAfn = round2(total * rate);
      const purchaseDate = daysAgo(10);

      const purNumber = await nextDocNumber(tx, mzr.id, "PURCHASE");
      const purchase = await tx.purchase.create({
        data: {
          localId: randomUUID(),
          number: purNumber,
          branchId: mzr.id,
          supplierId: supSahara.id,
          warehouseId: mzr.mainWarehouseId,
          type: "IMPORT",
          date: purchaseDate,
          currency: "USD",
          exchangeRate: rate,
          subtotal,
          discountTotal,
          extraCost,
          total,
          totalAfn,
          paidAmount: totalAfn, // پرداخت کامل
          returnedAfn: 0,
          status: "APPROVED",
          notes: "داده نمایشی — خرید اولیه گدام از شرکت وارداتی صحرا",
          createdBy: user.id,
          createdByName: user.fullName,
          approvedBy: user.fullName,
          approvedAt: purchaseDate,
        },
      });

      const lineTotalAfns = computed.map((l) => round2(l.lineTotal * rate));
      const extraAlloc = allocExtraCost(
        round2(extraCost * rate),
        computed.map((l, i) => ({ lineTotalAfn: lineTotalAfns[i], quantity: l.quantity })),
        "VALUE"
      );

      const batchIds: Record<string, string> = {}; // `${productId}:${batchNumber}` → batchId
      const itemRows: Prisma.PurchaseItemCreateManyInput[] = [];
      for (let i = 0; i < computed.length; i++) {
        const l = computed[i];
        const productId = productIds[l.productName];
        const lineTotalAfn = lineTotalAfns[i];
        const effectiveCost = computeEffectiveCost(
          round2(lineTotalAfn + extraAlloc[i]),
          l.quantity,
          l.freeQuantity
        );
        const mfgDate = daysAgo(l.mfgDaysAgo);
        const expiryDate = daysAhead(l.expiryDaysAhead);
        const batch = await createBatchIfMissing(tx, {
          productId,
          batchNumber: l.batchNumber,
          mfgDate,
          expiryDate,
          costPrice: effectiveCost,
          purchaseId: purchase.id,
        });
        batchIds[`${productId}:${l.batchNumber}`] = batch.id;
        itemRows.push({
          purchaseId: purchase.id,
          productId,
          batchNumber: l.batchNumber,
          mfgDate,
          expiryDate,
          quantity: l.quantity,
          freeQuantity: l.freeQuantity,
          unitPrice: l.unitPrice,
          discountPct: l.discountPct,
          discountAmount: 0,
          netUnitPrice: l.netUnitPrice,
          effectiveCost,
          lineTotal: l.lineTotal,
          lineTotalAfn,
          batchId: batch.id,
        });
        // ورود موجودی به گدام اصلی مزار شریف (تعداد مجانی هم وارد گدام می‌شود)
        await applyStockMovement(tx, {
          productId,
          batchId: batch.id,
          toWarehouseId: mzr.mainWarehouseId,
          type: "IN",
          quantity: round2(l.quantity + l.freeQuantity),
          reason: "ورود از خرید وارداتی",
          referenceType: "PURCHASE",
          referenceId: purchase.id,
          userId: user.id,
          userName: user.fullName,
          branchId: mzr.id,
        });
      }
      await tx.purchaseItem.createMany({ data: itemRows });

      // رسید پرداخت کامل خرید
      const payNumber = await nextDocNumber(tx, mzr.id, "PAYMENT");
      await tx.payment.create({
        data: {
          localId: randomUUID(),
          number: payNumber,
          type: "SUPPLIER",
          direction: "OUT",
          branchId: mzr.id,
          supplierId: supSahara.id,
          purchaseId: purchase.id,
          amount: totalAfn,
          currency: "USD",
          exchangeRate: rate,
          method: "BANK",
          reference: "TT-2401",
          date: purchaseDate,
          notes: "پرداخت کامل فاکتور خرید نمایشی",
          createdBy: user.id,
          createdByName: user.fullName,
          status: "COMPLETED",
        },
      });
      await recalcSupplierBalance(tx, supSahara.id);
      const finalPurchase = await recalcPurchaseStatus(tx, purchase.id);
      await logAudit(tx, {
        userId: user.id,
        userName: user.fullName,
        branchId: user.branchId,
        action: "CREATE",
        entity: "Purchase",
        entityId: purchase.id,
        summary: `داده نمایشی — خرید ${purNumber} از شرکت وارداتی صحرا`,
      });

      // ─────────────── فروش‌ها (۲ فاکتور) ───────────────
      const createDemoSale = async (opts: {
        customerIdx: number;
        lines: DemoSaleLine[];
        paidAmount: number;
        date: Date;
        note: string;
      }) => {
        const customer = customerRows[opts.customerIdx];
        const saleRate = 1;
        let saleSubtotal = 0;
        let saleDiscount = 0;
        const saleLines = opts.lines.map((l) => {
          const netUnitPrice = round2(l.unitPrice);
          const lineTotal = round2(l.quantity * netUnitPrice);
          saleSubtotal += lineTotal;
          return { ...l, netUnitPrice, lineTotal };
        });
        saleSubtotal = round2(saleSubtotal);
        const saleTotalAfn = round2(saleSubtotal * saleRate);
        const saleNumber = await nextDocNumber(tx, mzr.id, "SALE");

        const sale = await tx.sale.create({
          data: {
            localId: randomUUID(),
            number: saleNumber,
            branchId: mzr.id,
            customerId: customer.id,
            warehouseId: mzr.mainWarehouseId,
            salespersonId: customer.salespersonId,
            territoryId: customer.territoryId,
            type: "WHOLESALE",
            invoiceTemplate: "DETAILED",
            date: opts.date,
            currency: "AFN",
            exchangeRate: saleRate,
            subtotal: saleSubtotal,
            discountTotal: saleDiscount,
            total: saleSubtotal,
            totalAfn: saleTotalAfn,
            paidAmount: round2(opts.paidAmount),
            returnedAfn: 0,
            status: "APPROVED",
            notes: opts.note,
            createdBy: user.id,
            createdByName: user.fullName,
            approvedBy: user.fullName,
            approvedAt: opts.date,
          },
        });

        for (const l of saleLines) {
          const productId = productIds[l.productName];
          const batchId = batchIds[`${productId}:${l.batchNumber}`];
          if (!batchId) {
            throw new ApiError(`بچ ${l.batchNumber} برای ${l.productName} یافت نشد`, 500);
          }
          const batch = await tx.batch.findUnique({ where: { id: batchId } });
          if (!batch) {
            throw new ApiError("بچ یافت نشد", 500, "INTERNAL");
          }
          await tx.saleItem.create({
            data: {
              saleId: sale.id,
              productId,
              batchId,
              quantity: l.quantity,
              freeQuantity: 0,
              unitPrice: l.unitPrice,
              discountPct: 0,
              discountAmount: 0,
              netUnitPrice: l.netUnitPrice,
              costAtSale: batch.costPrice, // بهای تمام‌شده تاریخی از بچ
              lineTotal: l.lineTotal,
              lineTotalAfn: round2(l.lineTotal * saleRate),
            },
          });
          await applyStockMovement(tx, {
            productId,
            batchId,
            fromWarehouseId: mzr.mainWarehouseId,
            type: "OUT",
            quantity: l.quantity,
            reason: "فروش",
            referenceType: "SALE",
            referenceId: sale.id,
            userId: user.id,
            userName: user.fullName,
            branchId: mzr.id,
          });
        }

        if (opts.paidAmount > 0) {
          const payNum = await nextDocNumber(tx, mzr.id, "PAYMENT");
          await tx.payment.create({
            data: {
              localId: randomUUID(),
              number: payNum,
              type: "CUSTOMER",
              direction: "IN",
              branchId: mzr.id,
              customerId: customer.id,
              saleId: sale.id,
              amount: round2(opts.paidAmount),
              currency: "AFN",
              exchangeRate: 1,
              method: "CASH",
              date: opts.date,
              notes: "دریافت از مشتری — داده نمایشی",
              createdBy: user.id,
              createdByName: user.fullName,
              status: "COMPLETED",
            },
          });
        }
        await recalcCustomerBalance(tx, customer.id);
        const finalSale = await recalcSaleStatus(tx, sale.id);
        await logAudit(tx, {
          userId: user.id,
          userName: user.fullName,
          branchId: user.branchId,
          action: "CREATE",
          entity: "Sale",
          entityId: sale.id,
          summary: `داده نمایشی — فروش ${saleNumber}`,
        });
        return finalSale;
      };

      // فروش ۱: پرداخت کامل
      await createDemoSale({
        customerIdx: 1, // فارمسی شفا
        lines: [
          { productName: "پاراسیتامول تبلت 500mg", batchNumber: "B-2401", quantity: 6000, unitPrice: 1.8 },
          { productName: "اموکسی‌سلین کپسول 500mg", batchNumber: "B-2402", quantity: 3000, unitPrice: 3.9 },
        ],
        paidAmount: round2(6000 * 1.8 + 3000 * 3.9),
        date: daysAgo(5),
        note: "داده نمایشی — فروش نقدی",
      });

      // فروش ۲: پرداخت جزئی → ایجاد بدهی برای مشتری
      await createDemoSale({
        customerIdx: 2, // شفاخانه ابوذر
        lines: [
          { productName: "سرم نرمال سالین 500ml", batchNumber: "B-2404", quantity: 800, unitPrice: 30 },
          { productName: "ویتامین C 1000mg", batchNumber: "B-2403", quantity: 1500, unitPrice: 3.5 },
        ],
        paidAmount: 20000, // باقی به‌عنوان بدهی مشتری ثبت می‌شود
        date: daysAgo(2),
        note: "داده نمایشی — فروش قرضی با پرداخت جزئی",
      });

      // فروش ۳: قرضی با تعداد مجانی (پروموشن)
      await createDemoSale({
        customerIdx: 5, // داروخانه مرکزی بلخ
        lines: [
          { productName: "آرتمیتر/لومیفانترین تبلت", batchNumber: "B-2405", quantity: 1200, unitPrice: 8 },
          { productName: "آزیترومایسین تبلت 250mg", batchNumber: "B-2406", quantity: 900, unitPrice: 9 },
          { productName: "اورسرم اورال", batchNumber: "B-2407", quantity: 5000, unitPrice: 1 },
        ],
        paidAmount: 15000,
        date: daysAgo(1),
        note: "داده نمایشی — فروش عمده",
      });

      // ─────────────── مصارف MZR ───────────────
      const catRent = await tx.expenseCategory.upsert({
        where: { name: "کرایه/راجستر" },
        create: { name: "کرایه/راجستر" },
        update: {},
      });
      const catTransport = await tx.expenseCategory.upsert({
        where: { name: "ترانسپورت" },
        create: { name: "ترانسپورت" },
        update: {},
      });
      await tx.expense.create({
        data: {
          localId: randomUUID(),
          branchId: mzr.id,
          categoryId: catRent.id,
          amount: 12000,
          currency: "AFN",
          exchangeRate: 1,
          amountAfn: 12000,
          date: daysAgo(6),
          description: "کرایهٔ ماهانهٔ مغازه — داده نمایشی",
          status: "APPROVED",
          createdBy: user.id,
          createdByName: user.fullName,
          approvedBy: user.fullName,
        },
      });
      await tx.expense.create({
        data: {
          localId: randomUUID(),
          branchId: mzr.id,
          categoryId: catTransport.id,
          amount: 4500,
          currency: "AFN",
          exchangeRate: 1,
          amountAfn: 4500,
          date: daysAgo(3),
          description: "کرایهٔ کنتینر از کابل به مزار — داده نمایشی",
          status: "APPROVED",
          createdBy: user.id,
          createdByName: user.fullName,
          approvedBy: user.fullName,
        },
      });

      return {
        branches: branchDefs.length,
        warehouses: branchDefs.length,
        territories: territoryRows.length,
        salespersons: salespersonRows.length,
        categories: categoryNames.length,
        manufacturers: manufacturerNames.length,
        products: productDefs.length,
        suppliers: 3,
        customers: customerRows.length,
        purchases: 1,
        sales: 3,
        payments: 4,
        expenses: 2,
      };
}
