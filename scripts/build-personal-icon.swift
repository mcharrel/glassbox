import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

// Run from the repository root. Keep the supplied portrait untouched.
let sourceURL = URL(fileURLWithPath: "assets/app-icon.png")
let outputURL = URL(fileURLWithPath: "assets/app-icon-macos.png")
guard let source = CGImageSourceCreateWithURL(sourceURL as CFURL, nil),
      let portrait = CGImageSourceCreateImageAtIndex(source, 0, nil),
      let colorSpace = CGColorSpace(name: CGColorSpace.sRGB),
      let canvas = CGContext(data: nil, width: 1024, height: 1024,
                             bitsPerComponent: 8, bytesPerRow: 0,
                             space: colorSpace,
                             bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
else { fatalError("Cannot load the portrait or create the icon canvas") }

// Legacy ICNS icons need their own rounded silhouette and transparent Dock margin.
let tile = CGRect(x: 100, y: 100, width: 824, height: 824)
canvas.addPath(CGPath(roundedRect: tile, cornerWidth: 185, cornerHeight: 185,
                     transform: nil))
canvas.clip()
canvas.setFillColor(CGColor(gray: 1, alpha: 1))
canvas.fill(tile)
canvas.interpolationQuality = .high
canvas.draw(portrait, in: tile.insetBy(dx: 28, dy: 28))

guard let icon = canvas.makeImage(),
      let destination = CGImageDestinationCreateWithURL(
        outputURL as CFURL, UTType.png.identifier as CFString, 1, nil)
else { fatalError("Cannot create the icon PNG") }
CGImageDestinationAddImage(destination, icon, nil)
guard CGImageDestinationFinalize(destination) else { fatalError("Cannot save the icon PNG") }
print(outputURL.path)
