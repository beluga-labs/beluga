//! macOS's Mic Mode for calls (BLG-744): Standard, Voice Isolation or Wide Spectrum. WebKit takes
//! no `noiseSuppression` from a page (only echo cancellation, which turns on macOS's voice
//! processing), so background noise is macOS's to take out: Voice Isolation does it far better
//! than anything a page could. macOS lets only you pick it, from Control Center, for each app; this
//! says which one Beluga has, and opens that picker.

use serde::Serialize;

/// Beluga's Mic Mode as macOS has it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MicMode {
    /// This Mac has Mic Modes (macOS 12 and later).
    pub available: bool,
    /// The one you picked for Beluga: "standard", "voiceIsolation" or "wideSpectrum".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preferred: Option<&'static str>,
    /// The one working now (only while the microphone is on).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active: Option<&'static str>,
}

const UNAVAILABLE: MicMode = MicMode {
    available: false,
    preferred: None,
    active: None,
};

#[cfg(target_os = "macos")]
mod mac {
    use objc2::runtime::{AnyClass, Bool, Sel};
    use objc2::{msg_send, sel};

    // AVCaptureDevice lives here; Beluga's own code doesn't otherwise name it.
    #[link(name = "AVFoundation", kind = "framework")]
    extern "C" {}

    /// `AVCaptureSystemUserInterfaceMicrophoneModes`.
    const MICROPHONE_MODES: isize = 2;

    fn device_class() -> Option<&'static AnyClass> {
        AnyClass::get(c"AVCaptureDevice")
    }

    fn responds(cls: &AnyClass, sel: Sel) -> bool {
        // SAFETY: asking a class object whether it answers a selector has no other effect.
        let has: Bool = unsafe { msg_send![cls, respondsToSelector: sel] };
        has.as_bool()
    }

    /// `AVCaptureMicrophoneMode` in words.
    fn word(mode: isize) -> Option<&'static str> {
        match mode {
            0 => Some("standard"),
            1 => Some("wideSpectrum"),
            2 => Some("voiceIsolation"),
            _ => None,
        }
    }

    pub fn read() -> super::MicMode {
        let Some(cls) = device_class() else {
            return super::UNAVAILABLE;
        };
        let (pref, act) = (sel!(preferredMicrophoneMode), sel!(activeMicrophoneMode));
        if !responds(cls, pref) || !responds(cls, act) {
            return super::UNAVAILABLE;
        }
        // SAFETY: both are class properties of AVCaptureDevice returning an NSInteger enum, and
        // the class says it has them.
        let (preferred, active): (isize, isize) = unsafe {
            (
                msg_send![cls, preferredMicrophoneMode],
                msg_send![cls, activeMicrophoneMode],
            )
        };
        super::MicMode {
            available: true,
            preferred: word(preferred),
            active: word(active),
        }
    }

    /// Opens macOS's Mic Mode picker (in Control Center). Main thread only.
    pub fn open() {
        let Some(cls) = device_class() else {
            return;
        };
        if !responds(cls, sel!(showSystemUserInterface:)) {
            return;
        }
        // SAFETY: a class method of AVCaptureDevice taking an NSInteger enum, which the class has.
        unsafe {
            let _: () = msg_send![cls, showSystemUserInterface: MICROPHONE_MODES];
        }
    }
}

/// Beluga's Mic Mode now.
#[tauri::command]
pub fn mic_mode() -> MicMode {
    #[cfg(target_os = "macos")]
    return mac::read();
    #[cfg(not(target_os = "macos"))]
    UNAVAILABLE
}

/// Opens macOS's Mic Mode picker, where you pick Voice Isolation for Beluga.
#[tauri::command]
pub fn mic_mode_picker(app: tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    let _ = app.run_on_main_thread(mac::open);
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}
