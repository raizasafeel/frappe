# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and Contributors
# License: MIT. See LICENSE
from unittest.mock import patch

import frappe
from frappe.desk.page.setup_wizard import setup_wizard
from frappe.tests import IntegrationTestCase, set_user

PREFILLED_SETTINGS = {"language": "en", "country": "India", "time_zone": "Asia/Kolkata", "currency": "INR"}


def make_signed_up_user(email, first_name="Priya", last_name="Sharma"):
	user = frappe.new_doc("User")
	user.update({"email": email, "first_name": first_name, "last_name": last_name, "send_welcome_email": 0})
	user.append_roles("System Manager")
	user.insert(ignore_permissions=True)
	return user


class TestPrefilledSetupData(IntegrationTestCase):
	def setUp(self):
		frappe.db.savepoint("prefilled_setup")
		self.addCleanup(frappe.db.rollback, save_point="prefilled_setup")
		self.user = make_signed_up_user("prefilled-setup@example.com")

	def get_prefilled(self, settings=PREFILLED_SETTINGS):
		with patch.object(frappe.db, "get_singles_dict", return_value=frappe._dict(settings)):
			return setup_wizard.get_prefilled_setup_data()

	def test_prefilled_from_settings_and_session_user(self):
		with set_user(self.user.name):
			data = self.get_prefilled()

		self.assertEqual(
			data,
			{
				"language": "English",
				"country": "India",
				"timezone": "Asia/Kolkata",
				"currency": "INR",
				"full_name": "Priya Sharma",
				"email": "prefilled-setup@example.com",
			},
		)

	def test_not_prefilled_without_region(self):
		for key in PREFILLED_SETTINGS:
			with self.subTest(missing=key), set_user(self.user.name):
				self.assertIsNone(self.get_prefilled({**PREFILLED_SETTINGS, key: None}))

	def test_not_prefilled_without_signed_up_user(self):
		User = frappe.qb.DocType("User")
		frappe.qb.update(User).set(User.enabled, 0).where(User.name.notin(frappe.STANDARD_USERS)).run()

		self.assertIsNone(self.get_prefilled())

	def test_website_user_is_not_the_signed_up_user(self):
		frappe.db.set_value("User", self.user.name, "user_type", "Website User")

		with set_user(self.user.name):
			data = self.get_prefilled()

		self.assertNotEqual((data or {}).get("email"), self.user.name)


class TestSetupCompleteWithPrefilledData(IntegrationTestCase):
	def setUp(self):
		frappe.db.savepoint("prefilled_setup_complete")
		self.addCleanup(frappe.clear_cache, doctype="System Settings")
		self.addCleanup(frappe.db.rollback, save_point="prefilled_setup_complete")
		self.user = make_signed_up_user("prefilled-complete@example.com", "Old", "Name")

	def test_setup_completes_for_existing_user_without_password(self):
		args = {
			"language": "English",
			"country": "Germany",
			"timezone": "Europe/Berlin",
			"currency": "EUR",
			"full_name": "Priya Sharma",
			"email": self.user.name,
			"enable_telemetry": 0,
		}
		with (
			patch.object(frappe, "is_setup_complete", return_value=False),
			patch.object(setup_wizard, "get_setup_wizard_completed_apps", return_value=[]),
			patch.object(setup_wizard, "get_stages_hooks", return_value=[]),
			patch.object(setup_wizard, "get_setup_complete_hooks", return_value=[]),
			patch.object(setup_wizard, "run_setup_success"),
			patch.object(setup_wizard, "run_post_setup_complete"),
			patch.object(setup_wizard, "apply_telemetry_preference"),
			patch.object(frappe, "enqueue"),
			patch.object(setup_wizard, "update_password") as update_password,
			patch("frappe.utils.telemetry.capture"),
		):
			self.assertEqual(setup_wizard.setup_complete(args), {"status": "ok"})

		update_password.assert_not_called()
		user = frappe.db.get_value(
			"User", self.user.name, ["first_name", "last_name", "full_name"], as_dict=True
		)
		self.assertEqual(user, {"first_name": "Priya", "last_name": "Sharma", "full_name": "Priya Sharma"})
		self.assertEqual(frappe.db.get_single_value("System Settings", "country"), "Germany")
		self.assertEqual(frappe.db.get_single_value("System Settings", "time_zone"), "Europe/Berlin")
