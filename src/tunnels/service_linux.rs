/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

use std::{
	fs::File,
	io::{self, Write},
	path::PathBuf,
	process::Command,
};

use async_trait::async_trait;
use tokio::sync::mpsc;
use zbus::{dbus_proxy, zvariant, Connection};

use crate::{
	commands::tunnels::ShutdownSignal,
	constants::{APPLICATION_NAME, PRODUCT_NAME_LONG},
	log,
	state::LauncherPaths,
	util::errors::{wrap, AnyError},
};

use super::ServiceManager;

pub struct SystemdService {
	log: log::Logger,
	service_file: PathBuf,
}

impl SystemdService {
	pub fn new(log: log::Logger, paths: LauncherPaths) -> Self {
		Self {
			log,
			service_file: paths.root().join(SystemdService::service_name_string()),
		}
	}
}

impl SystemdService {
	async fn connect() -> Result<Connection, AnyError> {
		let connection = Connection::session()
			.await
			.map_err(|e| wrap(e, "error creating dbus session"))?;
		Ok(connection)
	}

	async fn proxy(connection: &Connection) -> Result<SystemdManagerDbusProxy<'_>, AnyError> {
		let proxy = SystemdManagerDbusProxy::new(connection)
			.await
			.map_err(|e| {
				wrap(
					e,
					"error connecting to systemd, you may need to re-run with sudo:",
				)
			})?;

		Ok(proxy)
	}

	fn service_path_string(&self) -> String {
		self.service_file.as_os_str().to_string_lossy().to_string()
	}

	fn service_name_string() -> String {
		format!("{}-tunnel.service", &*APPLICATION_NAME)
	}
}

#[async_trait]
impl ServiceManager for SystemdService {
	async fn register(
		&self,
		exe: std::path::PathBuf,
		args: &[&str],
	) -> Result<(), crate::util::errors::AnyError> {
		let connection = SystemdService::connect().await?;
		let proxy = SystemdService::proxy(&connection).await?;

		write_systemd_service_file(&self.service_file, exe, args)
			.map_err(|e| wrap(e, "error creating service file"))?;

		proxy
			.link_unit_files(
				vec![self.service_path_string()],
				/* 'runtime only'= */ false,
				/* replace existing = */ true,
			)
			.await
			.map_err(|e| wrap(e, "error registering service"))?;

		info!(self.log, "Successfully registered service...");

		proxy
			.start_unit(SystemdService::service_name_string(), "replace".to_string())
			.await
			.map_err(|e| wrap(e, "error starting service"))?;

		info!(self.log, "Tunnel service successfully started");

		Ok(())
	}

	async fn run(
		self,
		launcher_paths: crate::state::LauncherPaths,
		mut handle: impl 'static + super::ServiceContainer,
	) -> Result<(), crate::util::errors::AnyError> {
		let (tx, rx) = mpsc::unbounded_channel::<ShutdownSignal>();
		tokio::spawn(async move {
			tokio::signal::ctrl_c().await.ok();
			tx.send(ShutdownSignal::CtrlC).ok();
		});

		handle.run_service(self.log, launcher_paths, rx).await
	}

	async fn show_logs(&self) -> Result<(), AnyError> {
		// show the systemctl status header...
		Command::new("systemctl")
			.args([
				"--user",
				"status",
				"-n",
				"0",
				&SystemdService::service_name_string(),
			])
			.status()
			.map(|s| s.code().unwrap_or(1))
			.map_err(|e| wrap(e, "error running systemctl"))?;

		// then follow log files
		Command::new("journalctl")
			.args(["--user", "-f", "-u", &SystemdService::service_name_string()])
			.status()
			.map(|s| s.code().unwrap_or(1))
			.map_err(|e| wrap(e, "error running journalctl"))?;
		Ok(())
	}

	async fn unregister(&self) -> Result<(), crate::util::errors::AnyError> {
		let connection = SystemdService::connect().await?;
		let proxy = SystemdService::proxy(&connection).await?;

		proxy
			.stop_unit(SystemdService::service_name_string(), "replace".to_string())
			.await
			.map_err(|e| wrap(e, "error unregistering service"))?;

		info!(self.log, "Successfully stopped service...");

		proxy
			.disable_unit_files(
				vec![SystemdService::service_name_string()],
				/* 'runtime only'= */ false,
			)
			.await
			.map_err(|e| wrap(e, "error unregistering service"))?;

		info!(self.log, "Tunnel service uninstalled");

		Ok(())
	}
}

fn write_systemd_service_file(
	path: &PathBuf,
	exe: std::path::PathBuf,
	args: &[&str],
) -> io::Result<()> {
	let mut f = File::create(path)?;
	write!(
		&mut f,
		"[Unit]\n\
      Description={} Tunnel\n\
      After=network.target\n\
      StartLimitIntervalSec=0\n\
      \n\
      [Service]\n\
      Type=simple\n\
      Restart=always\n\
      RestartSec=10\n\
      ExecStart={} \"{}\"\n\
      \n\
      [Install]\n\
      WantedBy=multi-user.target\n\
    ",
		&*PRODUCT_NAME_LONG,
		exe.into_os_string().to_string_lossy(),
		args.join("\" \"")
	)?;
	Ok(())
}

/// Minimal implementation of systemd types for the services we need. The full
/// definition can be found on any systemd machine with the command:
///
/// gdbus introspect --system --dest org.freedesktop.systemd1 --object-path /org/freedesktop/systemd1
///
/// See docs here: https://www.freedesktop.org/software/systemd/man/org.freedesktop.systemd1.html
#[dbus_proxy(
	interface = "org.freedesktop.systemd1.Manager",
	gen_blocking = false,
	default_service = "org.freedesktop.systemd1",
	default_path = "/org/freedesktop/systemd1"
)]
trait SystemdManagerDbus {
	#[dbus_proxy(name = "EnableUnitFiles")]
	fn enable_unit_files(
		&self,
		files: Vec<String>,
		runtime: bool,
		force: bool,
	) -> zbus::Result<(bool, Vec<(String, String, String)>)>;

	fn link_unit_files(
		&self,
		files: Vec<String>,
		runtime: bool,
		force: bool,
	) -> zbus::Result<Vec<(String, String, String)>>;

	fn disable_unit_files(
		&self,
		files: Vec<String>,
		runtime: bool,
	) -> zbus::Result<Vec<(String, String, String)>>;

	#[dbus_proxy(name = "StartUnit")]
	fn start_unit(&self, name: String, mode: String) -> zbus::Result<zvariant::OwnedObjectPath>;

	#[dbus_proxy(name = "StopUnit")]
	fn stop_unit(&self, name: String, mode: String) -> zbus::Result<zvariant::OwnedObjectPath>;
}
