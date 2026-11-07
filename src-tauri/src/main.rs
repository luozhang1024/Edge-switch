#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    std::panic::set_hook(Box::new(|info| {
        edge_switch_lib::startup::report(&info.to_string())
    }));
    edge_switch_lib::run();
}
