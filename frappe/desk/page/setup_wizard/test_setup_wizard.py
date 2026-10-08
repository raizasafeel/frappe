# Copyright (c) 2025, Frappe Technologies Pvt. Ltd. and Contributors
# License: MIT. See LICENSE
from unittest.mock import MagicMock, patch

import frappe
from frappe import _
from frappe.desk.page.setup_wizard import setup_wizard
from frappe.tests import IntegrationTestCase, UnitTestCase, set_user
from frappe.utils.synchronization import LockTimeoutError


def fake_hooks(apps):
	def get_hooks(hook=None, default=None, app_name=None):
		if app_name:
			return apps.get(app_name, {})
		merged = []
		for app_hooks in apps.values():
			merged += app_hooks.get(hook, [])
		return merged

	return get_hooks


class TestSetupWizardUrl(UnitTestCase):
	def resolve(self, apps):
		with (
			patch.object(frappe, "get_installed_apps", return_value=list(apps)),
			patch.object(frappe, "get_active_apps", return_value=list(apps)),
			patch.object(frappe, "get_hooks", side_effect=fake_hooks(apps)),
		):
			url = setup_wizard.get_setup_wizard_url()
			builtin = setup_wizard.site_requires_builtin_wizard()
			return url, builtin

	def test_defaults_to_desk(self):
		url, builtin = self.resolve({"frappe": {}})
		self.assertEqual(url, "/desk/setup-wizard")
		self.assertFalse(builtin)

	def test_uses_app_url(self):
		url, builtin = self.resolve({"suite": {"setup_wizard_url": ["/suite/setup"]}})
		self.assertEqual(url, "/suite/setup")
		self.assertFalse(builtin)

	def test_last_app_wins(self):
		url, _ = self.resolve(
			{
				"suite": {"setup_wizard_url": ["/suite/setup"]},
				"gameplan": {"setup_wizard_url": ["/gameplan/setup"]},
			}
		)
		self.assertEqual(url, "/gameplan/setup")

	def test_stage_app_forces_desk(self):
		url, builtin = self.resolve(
			{
				"suite": {"setup_wizard_url": ["/suite/setup"]},
				"erpnext": {"setup_wizard_stages": ["erpnext.setup.get_setup_stages"]},
			}
		)
		self.assertEqual(url, "/desk/setup-wizard")
		self.assertTrue(builtin)

	def test_complete_hook_forces_desk(self):
		url, builtin = self.resolve(
			{
				"suite": {"setup_wizard_url": ["/suite/setup"]},
				"crm": {"setup_wizard_complete": ["crm.setup.after_complete"]},
			}
		)
		self.assertEqual(url, "/desk/setup-wizard")
		self.assertTrue(builtin)


class TestCompleteAppSetup(IntegrationTestCase):
	def test_setup_jobs_are_not_released_by_intermediate_commits(self):
		queue = MagicMock(count=0)
		enqueue_counts_during_setup = []

		def setup_task(_args):
			frappe.enqueue("frappe.utils.background_jobs.get_queue_list", enqueue_after_commit=True)
			frappe.db.commit()  # Exercise an intermediate setup commit; nosemgrep
			enqueue_counts_during_setup.append(queue.enqueue_call.call_count)

		stages = [{"tasks": [{"fn": setup_task, "args": frappe._dict()}]}]
		with (
			patch("frappe.utils.background_jobs.get_queue", return_value=queue),
			patch.object(setup_wizard, "get_setup_wizard_completed_apps", return_value=[]),
			patch.object(setup_wizard, "run_setup_success"),
			patch.object(setup_wizard, "apply_telemetry_preference"),
			patch.object(setup_wizard, "clear_cache_after_maintenance"),
			patch("frappe.utils.telemetry.capture"),
		):
			setup_wizard.process_setup_stages(stages, frappe._dict())

		self.assertEqual(enqueue_counts_during_setup, [0])
		queue.enqueue_call.assert_not_called()
		frappe.db.commit()  # Release callbacks at the request's final commit; nosemgrep
		queue.enqueue_call.assert_called_once()

	def test_setup_jobs_are_discarded_after_a_handled_failure(self):
		queue = MagicMock(count=0)

		def failing_setup_task(_args):
			frappe.enqueue("frappe.utils.background_jobs.get_queue_list", enqueue_after_commit=True)
			frappe.db.commit()  # Exercise an intermediate setup commit; nosemgrep
			raise RuntimeError

		stages = [{"tasks": [{"fn": failing_setup_task, "args": frappe._dict()}]}]
		with (
			patch("frappe.utils.background_jobs.get_queue", return_value=queue),
			patch.object(setup_wizard, "get_setup_wizard_completed_apps", return_value=[]),
			patch.object(setup_wizard, "handle_setup_exception"),
			patch.object(setup_wizard, "clear_cache_after_maintenance"),
			patch.object(frappe, "log_error"),
			patch("frappe.utils.telemetry.capture"),
		):
			setup_wizard.process_setup_stages(stages, frappe._dict(), is_background_task=True)

		frappe.db.commit()  # Prove a later commit cannot release cancelled jobs; nosemgrep
		queue.enqueue_call.assert_not_called()

	def test_global_settings_defer_timezone_job_until_commit(self):
		args = frappe._dict(language="French", lang="fr", timezone="Europe/Paris")
		with (
			patch.object(setup_wizard, "set_default_language"),
			patch.object(setup_wizard, "get_language_code", return_value="fr"),
			patch.object(frappe, "clear_cache"),
			patch.object(setup_wizard, "update_system_settings"),
			patch.object(setup_wizard, "create_or_update_user"),
			patch.object(frappe, "enqueue") as enqueue,
			patch.object(frappe.db, "commit") as commit,
		):
			setup_wizard.update_global_settings(args)

		commit.assert_not_called()
		enqueue.assert_called_once_with(
			setup_wizard.set_timezone,
			timezone="Europe/Paris",
			enqueue_after_commit=True,
		)

	def test_post_setup_does_not_commit_before_completion_marker(self):
		with (
			patch.object(setup_wizard, "disable_future_access"),
			patch.object(frappe, "clear_cache"),
			patch.object(frappe, "get_cached_doc", return_value=None),
			patch.object(frappe.db, "commit") as commit,
		):
			setup_wizard.run_post_setup_complete({})

		commit.assert_not_called()

	def test_needs_system_manager(self):
		with set_user("Guest"):
			self.assertRaises(frappe.PermissionError, setup_wizard.complete_app_setup)

	def test_refuses_builtin_site(self):
		with patch.object(setup_wizard, "site_requires_builtin_wizard", return_value=True):
			self.assertRaises(frappe.ValidationError, setup_wizard.complete_app_setup)

	def test_skips_when_already_complete(self):
		with (
			patch.object(setup_wizard, "site_requires_builtin_wizard", return_value=False),
			patch.object(frappe, "is_setup_complete", return_value=True),
			patch.object(setup_wizard, "process_setup_stages") as process_stages,
		):
			self.assertEqual(setup_wizard.complete_app_setup(), {"status": "ok"})
			process_stages.assert_not_called()

	def test_lock_timeout_never_reports_false_success(self):
		lock = MagicMock()
		lock.__enter__.side_effect = LockTimeoutError
		with (
			patch.object(setup_wizard, "site_requires_builtin_wizard", return_value=False),
			patch.object(setup_wizard, "filelock", return_value=lock),
		):
			with patch.object(frappe, "is_setup_complete", return_value=False):
				self.assertRaises(frappe.ValidationError, setup_wizard.complete_app_setup)
			with patch.object(frappe, "is_setup_complete", return_value=True):
				self.assertEqual(setup_wizard.complete_app_setup(), {"status": "ok"})


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
			patch.object(setup_wizard, "disable_future_access"),
			patch.object(setup_wizard, "apply_telemetry_preference"),
			patch.object(setup_wizard, "clear_cache_after_maintenance"),
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

	def test_administrator_setup_creates_the_owner(self):
		email = "cloud-owner@example.com"
		with patch.object(frappe.local, "login_manager", MagicMock(), create=True) as login_manager:
			setup_wizard.create_or_update_user({"full_name": "Priya Sharma", "email": email})
			setup_wizard.login_as_first_user({"email": email})

		self.assertEqual(frappe.session.user, "Administrator")
		self.assertEqual(frappe.db.get_value("User", email, "full_name"), "Priya Sharma")
		self.assertIn("System Manager", frappe.get_roles(email))
		login_manager.login_as.assert_called_once_with(email)


TEAM = {
	"user": "owner@example.com",
	"country": "India",
	"currency": "USD",
	"user_info": {"first_name": "Priya", "last_name": "Sharma"},
}


class TestCloudPrefilledSetupData(IntegrationTestCase):
	def setUp(self):
		frappe.cache.delete_value("setup_wizard_cloud_prefill")
		self.addCleanup(frappe.cache.delete_value, "setup_wizard_cloud_prefill")

	def fetch(self, **api):
		with (
			patch.object(setup_wizard.frappecloud_billing, "api", **api) as fc_api,
			patch.object(setup_wizard.frappe, "log_error"),
		):
			data = setup_wizard.fetch_cloud_prefilled_setup_data()
		fc_api.assert_called_once_with("team.info")
		return data

	def call(self, is_fc_site=True, setup_complete=False, **api):
		with (
			patch.object(setup_wizard.frappecloud_billing, "is_fc_site", return_value=is_fc_site),
			patch.object(setup_wizard.frappecloud_billing, "api", **api) as fc_api,
			patch.object(frappe, "is_setup_complete", return_value=setup_complete),
		):
			return setup_wizard.get_cloud_prefilled_setup_data(), fc_api

	def test_team_owner_becomes_setup_data(self):
		with patch.object(frappe.db, "get_single_value", return_value=None):
			data = self.fetch(return_value=TEAM)

		self.assertEqual(
			data,
			{
				"language": "English",
				"country": "India",
				"timezone": "Asia/Kolkata",
				"currency": "INR",
				"full_name": "Priya Sharma",
				"email": "owner@example.com",
			},
		)

	def test_billing_name_when_owner_has_no_name(self):
		data = self.fetch(return_value={**TEAM, "user_info": {}, "billing_name": "Acme Traders"})
		self.assertEqual(data["full_name"], "Acme Traders")

	def test_failure_is_none_without_a_message(self):
		messages = len(frappe.local.message_log)
		for error in (Exception("boom"), TimeoutError(), frappe.ValidationError("Failed while calling API")):
			with self.subTest(error=error):
				self.assertIsNone(self.fetch(side_effect=error))
		self.assertIsNone(self.fetch(side_effect=lambda *args: frappe.throw(_("Failed while calling API"))))
		self.assertEqual(len(frappe.local.message_log), messages)

	def test_missing_fields_are_none(self):
		for team in (
			None,
			{**TEAM, "user": None},
			{**TEAM, "user": "not-an-email"},
			{**TEAM, "country": None},
			{**TEAM, "country": "Atlantis"},
			{**TEAM, "user_info": None},
		):
			with self.subTest(team=team):
				self.assertIsNone(self.fetch(return_value=team))

	def test_fetched_once_and_cached(self):
		self.assertEqual(self.call(return_value=TEAM)[0]["email"], "owner@example.com")
		data, fc_api = self.call(side_effect=Exception("not called"))
		self.assertEqual(data["email"], "owner@example.com")
		fc_api.assert_not_called()

	def test_failure_is_not_cached(self):
		"""A failed fetch was cached for 5 minutes, so a new site kept the classic wizard
		on every reload. Unreleased, caught testing feat/setup-wizard-confirm-slide on Frappe Cloud."""
		self.assertIsNone(self.call(side_effect=Exception("Frappe Cloud unreachable"))[0])
		self.assertEqual(self.call(return_value=TEAM)[0]["email"], "owner@example.com")

	def test_not_called_off_frappe_cloud(self):
		data, fc_api = self.call(is_fc_site=False, return_value=TEAM)
		self.assertIsNone(data)
		fc_api.assert_not_called()

	def test_only_system_managers_before_setup(self):
		with set_user("Guest"), self.assertRaises(frappe.PermissionError):
			self.call(return_value=TEAM)
		with self.assertRaises(frappe.PermissionError):
			self.call(setup_complete=True, return_value=TEAM)
