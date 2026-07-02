fn main() {
    let target = std::env::var("TARGET").unwrap_or_default();

    if target.ends_with("apple-darwin") {
        for swift_runtime_path in [
            "/Library/Developer/CommandLineTools/usr/lib/swift/macosx",
            "/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/lib/swift/macosx",
        ] {
            if std::path::Path::new(swift_runtime_path).exists() {
                println!("cargo:rustc-link-search=native={swift_runtime_path}");
            }
        }

        if let Ok(output) = std::process::Command::new("xcrun")
            .args(["--sdk", "macosx", "--show-sdk-path"])
            .output()
        {
            if output.status.success() {
                let sdk_path = String::from_utf8_lossy(&output.stdout);
                let sdk_path = sdk_path.trim();

                if !sdk_path.is_empty() {
                    println!(
                        "cargo:rustc-link-search=framework={sdk_path}/System/Library/Frameworks"
                    );
                }
            }
        }

        for category_object in [
            "NSString+StdString.o",
            "RTCEncodedImage+Private.o",
            "RTCVideoCodecInfo+Private.o",
            "RTCVideoEncoderSettings+Private.o",
        ] {
            if let Some(category_object) = extract_webrtc_objc_category(category_object) {
                println!("cargo:rustc-link-arg={}", category_object.display());
            } else {
                println!(
                    "cargo:warning=failed to extract {category_object}; LiveKit may crash on macOS without Objective-C category methods"
                );
            }
        }

        println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
    }

    tauri_build::build()
}

fn extract_webrtc_objc_category(object_name: &str) -> Option<std::path::PathBuf> {
    let archive = find_livekit_webrtc_archive()?;
    let out_dir = std::path::PathBuf::from(std::env::var_os("OUT_DIR")?);
    let category_dir = out_dir.join("livekit-objc-categories");
    std::fs::create_dir_all(&category_dir).ok()?;

    let status = std::process::Command::new("ar")
        .current_dir(&category_dir)
        .args(["-x", archive.to_str()?, object_name])
        .status()
        .ok()?;

    if !status.success() {
        return None;
    }

    let extracted = category_dir.join(object_name);
    extracted.exists().then_some(extracted)
}

fn find_livekit_webrtc_archive() -> Option<std::path::PathBuf> {
    let out_dir = std::path::PathBuf::from(std::env::var_os("OUT_DIR")?);
    let profile_dir = out_dir.ancestors().nth(3)?;
    let build_dir = profile_dir.join("build");

    find_file_named(&build_dir, "libwebrtc.a", 8)
}

fn find_file_named(
    root: &std::path::Path,
    file_name: &str,
    max_depth: usize,
) -> Option<std::path::PathBuf> {
    if max_depth == 0 {
        return None;
    }

    let entries = std::fs::read_dir(root).ok()?;

    for entry in entries.flatten() {
        let path = entry.path();

        if path.file_name().and_then(|name| name.to_str()) == Some(file_name) {
            return Some(path);
        }

        if path.is_dir() {
            if let Some(found) = find_file_named(&path, file_name, max_depth - 1) {
                return Some(found);
            }
        }
    }

    None
}
