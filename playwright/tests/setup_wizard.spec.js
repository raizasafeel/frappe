import { test, expect } from "../support";

const PREFILLED = {
	language: "English",
	country: "India",
	timezone: "Asia/Kolkata",
	currency: "INR",
	full_name: "Priya Sharma",
	email: "priya@example.com",
};

test.describe("Setup wizard on a site prefilled at signup", () => {
	test("completes setup without asking anything", async ({ page }) => {
		// The test site has finished setup, so the page is served as a prefilled, unfinished site.
		const boot = {
			setup_complete: false,
			setup_wizard_completed_apps: [],
			setup_wizard_prefilled: PREFILLED,
		};
		await page.route("**/desk/setup-wizard", async (route) => {
			const response = await route.fetch();
			const script = `<script>
				Object.assign(frappe.boot, ${JSON.stringify(boot)});
				frappe.boot.sysdefaults.setup_complete = 0;
			</script>`;
			const body = (await response.text()).replace("</body>", `${script}</body>`);
			await route.fulfill({ response, body });
		});
		// stubbed, so the test site stays set up
		const setup_complete = new Promise((resolve) => {
			page.route("**/*setup_wizard.setup_complete", (route) => {
				resolve(route.request());
				return route.fulfill({ json: { message: { status: "registered" } } });
			});
		});

		await page.goto("/desk/setup-wizard");

		await expect(page.getByText("Setting things up")).toBeVisible();
		await expect(page.locator(".setup-intro")).toHaveCount(0);
		await expect(page.locator(".slide-wrapper")).toHaveCount(0);

		// form-encoded or JSON, depending on frappe's request body opt-in
		let { args } = (await setup_complete).postDataJSON();
		if (typeof args === "string") args = JSON.parse(args);
		expect(args).toEqual({ ...PREFILLED, enable_telemetry: expect.any(Number) });
	});
});

test.describe("Setup wizard on a new Frappe Cloud dashboard site", () => {
	test("waits for the Frappe Cloud token, then sets up with the team owner", async ({
		page,
	}) => {
		const boot = {
			setup_complete: false,
			setup_wizard_completed_apps: [],
			setup_wizard_prefilled: null,
			setup_wizard_cloud: "pending",
			is_fc_site: false,
		};
		await page.route("**/desk/setup-wizard", async (route) => {
			const response = await route.fetch();
			const script = `<script>
				Object.assign(frappe.boot, ${JSON.stringify(boot)});
				frappe.boot.sysdefaults.setup_complete = 0;
			</script>`;
			const body = (await response.text()).replace("</body>", `${script}</body>`);
			await route.fulfill({ response, body });
		});
		let fetches = 0;
		await page.route("**/*setup_wizard.get_cloud_prefilled_setup_data", (route) => {
			fetches++;
			const message = fetches <= 2 ? { pending: 1 } : PREFILLED;
			return route.fulfill({ json: { message } });
		});
		const setup_complete = new Promise((resolve) => {
			page.route("**/*setup_wizard.setup_complete", (route) => {
				resolve(route.request());
				return route.fulfill({ json: { message: { status: "registered" } } });
			});
		});

		await page.goto("/desk/setup-wizard");

		await expect(page.getByText("Setting things up")).toBeVisible();
		await expect(page.locator(".setup-intro")).toHaveCount(0);

		let { args } = (await setup_complete).postDataJSON();
		if (typeof args === "string") args = JSON.parse(args);
		expect(fetches).toBe(3);
		expect(args).toEqual({ ...PREFILLED, enable_telemetry: expect.any(Number) });
		await expect(page.locator(".slide-wrapper")).toHaveCount(0);
	});
});
