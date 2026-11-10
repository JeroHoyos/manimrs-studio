//! The commands the window calls, one module for each part of the app.
//!
//! A command checks what the window sent, then asks a library (studio_engine, studio_agent,
//! studio_shell) to do the work. A command never trusts the window: a talk is a valid name, an
//! order is on a list, a path is absolute.

pub mod chat;
pub mod slides;
pub mod system;
pub mod talks;
