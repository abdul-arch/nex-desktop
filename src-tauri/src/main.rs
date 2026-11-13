// Evite une console supplementaire en release sous Windows. NE PAS SUPPRIMER.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    nex_lib::run()
}
