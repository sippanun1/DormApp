import { Router } from 'express';
import { authRoutes } from './auth.routes.js';
import { bookingRoutes } from './bookings.routes.js';
import { announcementRoutes, requestRoutes } from './comms.routes.js';
import { checkoutRoutes } from './checkout.routes.js';
import { dashboardRoutes } from './dashboard.routes.js';
import { invoiceRoutes, tenancyInvoiceRoutes } from './invoices.routes.js';
import { lineRoutes } from './line.routes.js';
import { meterReadingRoutes, meterRoutes } from './meters.routes.js';
import { invoicePaymentRoutes, paymentRoutes } from './payments.routes.js';
import { reportRoutes } from './reports.routes.js';
import { roomRoutes, roomTypeRoutes } from './rooms.routes.js';
import { auditRoutes, settingsRoutes, utilityRateRoutes } from './settings.routes.js';
import { staffRoutes } from './staff.routes.js';
import { tenanciesRoutes } from './tenancies.routes.js';
import { tenantRoutes } from './tenants.routes.js';
import { tenantAppRoutes, tenantLinkRoutes } from './tenant.routes.js';

export const api = Router();

api.get('/health', (_req, res) => {
  res.json({ ok: true, tz: process.env.TZ, time: new Date().toISOString() });
});

api.use('/auth', authRoutes);
api.use('/dashboard', dashboardRoutes);
api.use('/rooms', roomRoutes);
api.use('/room-types', roomTypeRoutes);
api.use('/tenants', tenantRoutes);
// Phase 2: staff issue a link code off the tenant they are looking at.
api.use('/tenants', tenantLinkRoutes);
api.use('/bookings', bookingRoutes);
api.use('/tenancies', tenanciesRoutes);
// Meter readings hang off a tenancy to create, off their own id to correct.
api.use('/tenancies', meterRoutes);
api.use('/meter-readings', meterReadingRoutes);
// Invoices are generated against a tenancy, then read on their own id.
api.use('/tenancies', tenancyInvoiceRoutes);
// Move-out settlement (S27) — reads the tenancy, its meters and its bills.
api.use('/tenancies', checkoutRoutes);
api.use('/invoices', invoiceRoutes);
// Payment submission hangs off the invoice being settled; verification off the
// payment itself (ADR-007 — a different person, on a different screen).
api.use('/invoices', invoicePaymentRoutes);
api.use('/payments', paymentRoutes);
// Owner-only settings. Mounted at the root because they patch several
// resources (room types, rooms, system settings) that already have routers.
api.use('/', settingsRoutes);
api.use('/utility-rates', utilityRateRoutes);
api.use('/audit-log', auditRoutes);
// Rule 6: per-person checkboxes. Owner-only, like the four other powers §6 names.
api.use('/staff', staffRoutes);
// Owner-only money reports, read from verified payments and nothing else.
api.use('/reports', reportRoutes);
// Not money: what the office sends out (S41) and what comes in (S42).
api.use('/announcements', announcementRoutes);
api.use('/requests', requestRoutes);

// The tenant app. Mounted apart from everything above because it answers to a
// different kind of token: requireTenant refuses a staff token here, and
// requireAuth refuses a tenant token everywhere else. Read-only but for
// redeeming a code and marking a notification read.
api.use('/tenant', tenantAppRoutes);

// LINE's webhook. Unauthenticated by necessity — LINE presents no token — so
// the X-Line-Signature HMAC is the authentication, checked against the raw
// body captured in index.ts. It binds a LINE account to a tenant with the same
// link code the browser uses; it is not a way in (decision 2026-08-21).
api.use('/line', lineRoutes);
