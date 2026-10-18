import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

// Run from the repository root. Keep the supplied artwork untouched.
let sourceURL = URL(fileURLWithPath: "assets/app-icon.png")
let outputURL = URL(fileURLWithPath: "assets/app-icon-macos.png")
guard let source = CGImageSourceCreateWithURL(sourceURL as CFURL, nil),
      let image = CGImageSourceCreateImageAtIndex(source, 0, nil),
      let artwork = image.cropping(to: CGRect(x: 66, y: 88, width: 1121, height: 1092)),
      let colorSpace = CGColorSpace(name: CGColorSpace.sRGB),
      let canvas = CGContext(data: nil, width: 1024, height: 1024,
                             bitsPerComponent: 8, bytesPerRow: 0,
                             space: colorSpace,
                             bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
else { fatalError("Cannot load the artwork or create the icon canvas") }

// Trim the supplied PNG's transparent margin and preserve its existing rounded silhouette.
let width: CGFloat = 824
let height = width * CGFloat(artwork.height) / CGFloat(artwork.width)
let tile = CGRect(x: (1024 - width) / 2, y: (1024 - height) / 2, width: width, height: height)
// An opaque dark tile prevents macOS from nesting the translucent artwork in a pale frame.
canvas.addPath(CGPath(roundedRect: CGRect(x: 100, y: 100, width: 824, height: 824),
                     cornerWidth: 185, cornerHeight: 185, transform: nil))
canvas.setFillColor(CGColor(red: 36/255, green: 38/255, blue: 40/255, alpha: 1))
canvas.fillPath()
canvas.interpolationQuality = .high
canvas.draw(artwork, in: tile)

guard let icon = canvas.makeImage(),
      let destination = CGImageDestinationCreateWithURL(
        outputURL as CFURL, UTType.png.identifier as CFString, 1, nil)
else { fatalError("Cannot create the icon PNG") }
CGImageDestinationAddImage(destination, icon, nil)
guard CGImageDestinationFinalize(destination) else { fatalError("Cannot save the icon PNG") }
print(outputURL.path)
