use std::sync::Mutex;

use crate::storage::AppStorage;

pub struct DesktopState {
    pub initialized: Mutex<bool>,
    pub storage: Mutex<AppStorage>,
}

impl DesktopState {
    pub fn new(storage: AppStorage) -> Self {
        Self {
            initialized: Mutex::new(false),
            storage: Mutex::new(storage),
        }
    }
}

impl Default for DesktopState {
    fn default() -> Self {
        Self::new(AppStorage::default())
    }
}
