import { test, expect } from '@playwright/test';

test.describe('CoreS3-DebugMonitor Web UI', () => {
    test('loads home page with dark theme, title, and initial dashboard', async ({ page }) => {
        await page.goto('/');

        // Title and header brand
        await expect(page).toHaveTitle(/CoreS3-DebugMonitor/);
        await expect(page.locator('.logo-badge')).toHaveText('CoreS3');
        await expect(page.locator('.title-group h1')).toHaveText('DebugMonitor');

        // Navigation buttons exist
        await expect(page.locator('button[data-tab="dashboard"]')).toBeVisible();
        await expect(page.locator('button[data-tab="console"]')).toBeVisible();
        await expect(page.locator('button[data-tab="variables"]')).toBeVisible();
        await expect(page.locator('button[data-tab="diagnostics"]')).toBeVisible();

        // Dashboard active by default
        await expect(page.locator('#tabDashboard')).toHaveClass(/active/);
        await expect(page.locator('#dashDeviceName')).toBeVisible();
    });

    test('switches tabs smoothly between Console, Variables, and Diagnostics', async ({ page }) => {
        await page.goto('/');

        // Switch to Console
        await page.click('button[data-tab="console"]');
        await expect(page.locator('#tabConsole')).toHaveClass(/active/);
        await expect(page.locator('#tabDashboard')).not.toHaveClass(/active/);
        await expect(page.locator('#logLevelFilter')).toBeVisible();
        await expect(page.locator('#btnPauseConsole')).toBeVisible();

        // Switch to Variables
        await page.click('button[data-tab="variables"]');
        await expect(page.locator('#tabVariables')).toHaveClass(/active/);
        await expect(page.locator('#variablesGrid')).toBeVisible();

        // Switch to Diagnostics
        await page.click('button[data-tab="diagnostics"]');
        await expect(page.locator('#tabDiagnostics')).toHaveClass(/active/);
        await expect(page.locator('#btnExportReport')).toBeVisible();
        await expect(page.locator('#diagAvgUpdate')).toBeVisible();
    });

    test('generates diagnostic report on button click', async ({ page }) => {
        await page.goto('/');
        await page.click('button[data-tab="diagnostics"]');

        const btnExport = page.locator('#btnExportReport');
        await btnExport.click();

        const preview = page.locator('#reportPreviewContent');
        await expect(preview).toContainText('Rapport de Diagnostic');
    });
});
