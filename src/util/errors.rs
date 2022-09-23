/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
use std::fmt::Display;

use crate::constants::CONTROL_PORT;

// Wraps another error with additional info.
#[derive(Debug, Clone)]
pub struct WrappedError {
	message: String,
	original: String,
}

impl std::fmt::Display for WrappedError {
	fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
		write!(f, "{}: {}", self.message, self.original)
	}
}

impl std::error::Error for WrappedError {
	fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
		None
	}
}

impl WrappedError {
	// fn new(original: Box<dyn std::error::Error>, message: String) -> WrappedError {
	//     WrappedError { message, original }
	// }
}

impl From<reqwest::Error> for WrappedError {
	fn from(e: reqwest::Error) -> WrappedError {
		WrappedError {
			message: format!(
				"error requesting {}",
				e.url().map_or("<unknown>", |u| u.as_str())
			),
			original: format!("{}", e),
		}
	}
}

pub fn wrap<T, S>(original: T, message: S) -> WrappedError
where
	T: Display,
	S: Into<String>,
{
	WrappedError {
		message: message.into(),
		original: format!("{}", original),
	}
}

// Error generated by an unsuccessful HTTP response
#[derive(Debug)]
pub struct StatusError {
	url: String,
	status_code: u16,
	body: String,
}

impl std::fmt::Display for StatusError {
	fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
		write!(
			f,
			"error requesting {}: {} {}",
			self.url, self.status_code, self.body
		)
	}
}

impl StatusError {
	pub async fn from_res(res: reqwest::Response) -> Result<StatusError, AnyError> {
		let status_code = res.status().as_u16();
		let url = res.url().to_string();
		let body = res.text().await.map_err(|e| {
			wrap(
				e,
				format!(
					"failed to read response body on {} code from {}",
					status_code, url
				),
			)
		})?;

		Ok(StatusError {
			url,
			status_code,
			body,
		})
	}
}

// When the user has not consented to the licensing terms in using the Launcher
#[derive(Debug)]
pub struct MissingLegalConsent(pub String);

impl std::fmt::Display for MissingLegalConsent {
	fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
		write!(f, "{}", self.0)
	}
}

// When the provided connection token doesn't match the one used to set up the original VS Code Server
// This is most likely due to a new user joining.
#[derive(Debug)]
pub struct MismatchConnectionToken(pub String);

impl std::fmt::Display for MismatchConnectionToken {
	fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
		write!(f, "{}", self.0)
	}
}

// When the VS Code server has an unrecognized extension (rather than zip or gz)
#[derive(Debug)]
pub struct InvalidServerExtensionError(pub String);

impl std::fmt::Display for InvalidServerExtensionError {
	fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
		write!(f, "invalid server extension '{}'", self.0)
	}
}

// When the tunnel fails to open
#[derive(Debug, Clone)]
pub struct DevTunnelError(pub String);

impl std::fmt::Display for DevTunnelError {
	fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
		write!(f, "could not open tunnel: {}", self.0)
	}
}

impl std::error::Error for DevTunnelError {
	fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
		None
	}
}

// When the server was downloaded, but the entrypoint scripts don't exist.
#[derive(Debug)]
pub struct MissingEntrypointError();

impl std::fmt::Display for MissingEntrypointError {
	fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
		write!(f, "Missing entrypoints in server download. Most likely this is a corrupted download. Please retry")
	}
}

#[derive(Debug)]
pub struct SetupError(pub String);

impl std::fmt::Display for SetupError {
	fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
		write!(
			f,
			"{}\r\n\r\nMore info at https://code.visualstudio.com/docs/remote/linux",
			self.0
		)
	}
}

#[derive(Debug)]
pub struct NoHomeForLauncherError();

impl std::fmt::Display for NoHomeForLauncherError {
	fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
		write!(
            f,
            "No $HOME variable was found in your environment. Either set it, or specify a `--data-dir` manually when invoking the launcher.",
        )
	}
}

#[derive(Debug)]
pub struct InvalidTunnelName(pub String);

impl std::fmt::Display for InvalidTunnelName {
	fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
		write!(f, "{}", &self.0)
	}
}

#[derive(Debug)]
pub struct TunnelCreationFailed(pub String, pub String);

impl std::fmt::Display for TunnelCreationFailed {
	fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
		write!(
			f,
			"Could not create tunnel with name: {}\nReason: {}",
			&self.0, &self.1
		)
	}
}

#[derive(Debug)]
pub struct TunnelHostFailed(pub String);

impl std::fmt::Display for TunnelHostFailed {
	fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
		write!(f, "{}", &self.0)
	}
}

#[derive(Debug)]
pub struct ExtensionInstallFailed(pub String);

impl std::fmt::Display for ExtensionInstallFailed {
	fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
		write!(f, "Extension install failed: {}", &self.0)
	}
}

#[derive(Debug)]
pub struct MismatchedLaunchModeError();

impl std::fmt::Display for MismatchedLaunchModeError {
	fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
		write!(f, "A server is already running, but it was not launched in the same listening mode (port vs. socket) as this request")
	}
}

#[derive(Debug)]
pub struct NoAttachedServerError();

impl std::fmt::Display for NoAttachedServerError {
	fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
		write!(f, "No server is running")
	}
}

#[derive(Debug)]
pub struct ServerWriteError();

impl std::fmt::Display for ServerWriteError {
	fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
		write!(f, "Error writing to the server, it should be restarted")
	}
}

#[derive(Debug)]
pub struct RefreshTokenNotAvailableError();

impl std::fmt::Display for RefreshTokenNotAvailableError {
	fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
		write!(f, "Refresh token not available, authentication is required")
	}
}

#[derive(Debug)]
pub struct UnsupportedPlatformError();

impl std::fmt::Display for UnsupportedPlatformError {
	fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
		write!(
			f,
			"This operation is not supported on your current platform"
		)
	}
}

#[derive(Debug)]
pub struct NoInstallInUserProvidedPath(pub String);

impl std::fmt::Display for NoInstallInUserProvidedPath {
	fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
		write!(
            f,
            "No VS Code installation could be found in {}. You can run `code --use-quality=stable` to switch to the latest stable version of VS Code.",
            self.0
        )
	}
}

#[derive(Debug)]
pub struct InvalidRequestedVersion();

impl std::fmt::Display for InvalidRequestedVersion {
	fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
		write!(
            f,
            "The reqested version is invalid, expected one of 'stable', 'insiders', version number (x.y.z), or absolute path.",
        )
	}
}

#[derive(Debug)]
pub struct UserCancelledInstallation();

impl std::fmt::Display for UserCancelledInstallation {
	fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
		write!(f, "Installation aborted.")
	}
}

#[derive(Debug)]
pub struct CannotForwardControlPort();

impl std::fmt::Display for CannotForwardControlPort {
	fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
		write!(f, "Cannot forward or unforward port {}.", CONTROL_PORT)
	}
}

#[derive(Debug)]
pub struct ServerHasClosed();

impl std::fmt::Display for ServerHasClosed {
	fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
		write!(f, "Request cancelled because the server has closed")
	}
}

#[derive(Debug)]
pub struct UpdatesNotConfigured();

impl std::fmt::Display for UpdatesNotConfigured {
	fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
		write!(f, "Update service is not configured")
	}
}
#[derive(Debug)]
pub struct ServiceAlreadyRegistered();

impl std::fmt::Display for ServiceAlreadyRegistered {
	fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
		write!(f, "Already registered the service. Run `code tunnel service uninstall` to unregister it first")
	}
}

#[derive(Debug)]
pub struct WindowsNeedsElevation(pub String);

impl std::fmt::Display for WindowsNeedsElevation {
	fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
		writeln!(f, "{}", self.0)?;
		writeln!(f)?;
		writeln!(f, "You may need to run this command as an administrator:")?;
		writeln!(f, " 1. Open the start menu and search for Powershell")?;
		writeln!(f, " 2. Right click and 'Run as administrator'")?;
		if let Ok(exe) = std::env::current_exe() {
			writeln!(
				f,
				" 3. Run &'{}' '{}'",
				exe.display(),
				std::env::args().skip(1).collect::<Vec<_>>().join("' '")
			)
		} else {
			writeln!(f, " 3. Run the same command again",)
		}
	}
}

// Makes an "AnyError" enum that contains any of the given errors, in the form
// `enum AnyError { FooError(FooError) }` (when given `makeAnyError!(FooError)`).
// Useful to easily deal with application error types without making tons of "From"
// clauses.
macro_rules! makeAnyError {
    ($($e:ident),*) => {

        #[derive(Debug)]
        #[allow(clippy::enum_variant_names)]
        pub enum AnyError {
            $($e($e),)*
        }

        impl std::fmt::Display for AnyError {
            fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
                match *self {
                    $(AnyError::$e(ref e) => e.fmt(f),)*
                }
            }
        }

        impl std::error::Error for AnyError {
            fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
                None
            }
        }

        $(impl From<$e> for AnyError {
            fn from(e: $e) -> AnyError {
                AnyError::$e(e)
            }
        })*
    };
}

makeAnyError!(
	MissingLegalConsent,
	MismatchConnectionToken,
	DevTunnelError,
	StatusError,
	WrappedError,
	InvalidServerExtensionError,
	MissingEntrypointError,
	SetupError,
	NoHomeForLauncherError,
	TunnelCreationFailed,
	TunnelHostFailed,
	InvalidTunnelName,
	ExtensionInstallFailed,
	MismatchedLaunchModeError,
	NoAttachedServerError,
	ServerWriteError,
	UnsupportedPlatformError,
	RefreshTokenNotAvailableError,
	NoInstallInUserProvidedPath,
	UserCancelledInstallation,
	InvalidRequestedVersion,
	CannotForwardControlPort,
	ServerHasClosed,
	ServiceAlreadyRegistered,
	WindowsNeedsElevation,
	UpdatesNotConfigured
);

impl From<reqwest::Error> for AnyError {
	fn from(e: reqwest::Error) -> AnyError {
		AnyError::WrappedError(WrappedError::from(e))
	}
}
