//! Detection des encodeurs H.264 materiels (Media Foundation, MFTEnumEx + MFT_ENUM_FLAG_HARDWARE).
//! NEX refuse de demarrer la capture sans encodeur materiel : aucun repli silencieux vers
//! l'encodeur logiciel « H264 Encoder MFT ».

use windows::Win32::Media::MediaFoundation::{
    IMFActivate, MFMediaType_Video, MFT_CATEGORY_VIDEO_ENCODER, MFT_ENUM_FLAG_HARDWARE, MFT_ENUM_FLAG_SORTANDFILTER,
    MFT_FRIENDLY_NAME_Attribute, MFT_REGISTER_TYPE_INFO, MFTEnumEx, MFVideoFormat_H264,
};
use windows::Win32::System::Com::CoTaskMemFree;

/// Noms des encodeurs H.264 materiels disponibles, par ordre de preference du systeme.
pub fn hardware_h264_encoders() -> Vec<String> {
    let output = MFT_REGISTER_TYPE_INFO { guidMajorType: MFMediaType_Video, guidSubtype: MFVideoFormat_H264 };
    let mut activates: *mut Option<IMFActivate> = std::ptr::null_mut();
    let mut count: u32 = 0;
    let mut names = Vec::new();
    unsafe {
        if MFTEnumEx(
            MFT_CATEGORY_VIDEO_ENCODER,
            MFT_ENUM_FLAG_HARDWARE | MFT_ENUM_FLAG_SORTANDFILTER,
            None,
            Some(&output),
            &mut activates,
            &mut count,
        )
        .is_err()
            || activates.is_null()
        {
            return names;
        }
        let list = std::slice::from_raw_parts_mut(activates, count as usize);
        for slot in list.iter_mut() {
            if let Some(a) = slot.take() {
                let mut ptr = windows::core::PWSTR::null();
                let mut len = 0u32;
                if a.GetAllocatedString(&MFT_FRIENDLY_NAME_Attribute, &mut ptr, &mut len).is_ok() && !ptr.is_null() {
                    names.push(ptr.to_string().unwrap_or_default());
                    CoTaskMemFree(Some(ptr.0 as *const _));
                }
            }
        }
        CoTaskMemFree(Some(activates as *const _));
    }
    names
}

#[cfg(test)]
mod tests {
    #[test]
    fn enumeration_does_not_crash() {
        // Le resultat depend de la machine ; on verifie seulement que l'appel est sur.
        let _ = super::hardware_h264_encoders();
    }
}
