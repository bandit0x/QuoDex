// Double-clicking a desktop release or standalone preview should open only its window.
#![cfg_attr(any(not(debug_assertions), feature = "gemini-material-preview"), windows_subsystem = "windows")]

fn main() {
    codex_credits_view_lib::run()
}
