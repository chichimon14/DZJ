import Cocoa

let args = CommandLine.arguments
if args.count >= 3 {
    let imagePath = args[1]
    let filePath = args[2]
    if let img = NSImage(contentsOfFile: imagePath) {
        _ = NSWorkspace.shared.setIcon(img, forFile: filePath, options: [])
    }
}
