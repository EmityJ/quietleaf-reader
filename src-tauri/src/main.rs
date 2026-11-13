#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod desktop;
mod platform;

fn main() {
    desktop::run();
}
