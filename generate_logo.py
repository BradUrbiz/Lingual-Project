#!/usr/bin/env python3
"""
Generate Lingual logo and mascot using Gemini 2.5 Flash Image API
"""
from google import genai
from google.genai import types
from PIL import Image
import os
import sys

# Initialize client with API key
# Get API key from environment variable or command line
api_key = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")

if not api_key:
    print("❌ Error: No API key found!")
    print("\nPlease set your Google AI API key:")
    print("  export GOOGLE_API_KEY='your-api-key-here'")
    print("\nOr get one at: https://aistudio.google.com/app/apikey")
    sys.exit(1)

client = genai.Client(api_key=api_key)

# Prompts for logo and mascot
LOGO_PROMPT = """Professional wordmark logo for "Lingual" language learning app. The capital letter "L" is designed as an integrated speech bubble - the vertical stroke forms the left edge, horizontal stroke curves up to complete the bubble shape, with a small triangular tail pointing down-left. The "L" has thick 3-4px borders in brutalist style, filled with terracotta orange (#C75D3A). The remaining letters "ingual" are set in bold, chunky sans-serif font (Bricolage Grotesque style), colored in dark charcoal (#2D2A26). The speech-bubble "L" is 1.2x larger than other letters. Flat design, no gradients. Warm brutalism aesthetic with rounded corners (1rem radius). Clean, professional, suitable for educational technology. White or warm cream background (#F5F0E8). Vector-style illustration, horizontal layout."""

MASCOT_PROMPT = """Friendly frog mascot character for language learning app, geometric brutalist style. Simple construction using basic shapes: rounded body, simple legs, circular eyes on top of head. Thick 3-4px black outlines around all shapes. Terracotta orange body color (#C75D3A) with warm cream accents (#FFFDF9) on belly. Large, kind circular eyes sitting on top of head, gentle smile. Sitting pose in welcoming position with legs visible. Flat design with no gradients or shading. Optional: subtle drop shadow effect (4px offset, solid color). Character holds or is next to a chunky speech bubble with same thick border style. Professional but approachable, suitable for both children and adults. Warm brutalism aesthetic - simple but friendly. Clean, minimal details. White or warm cream background (#F5F0E8). Vector-style illustration, mascot design, full body visible."""

COMBINED_PROMPT = """Complete brand identity design: "Lingual" wordmark logo with geometric frog mascot. LEFT SIDE: Wordmark where letter "L" is designed as speech bubble with thick borders, filled terracotta orange (#C75D3A), remaining "ingual" in bold sans-serif charcoal (#2D2A26). RIGHT SIDE: Friendly geometric frog mascot with chunky 3-4px outlines, terracotta body, cream belly, simple shapes, circular eyes on top of head, holding/next to matching speech bubble. Both elements use warm brutalism aesthetic - thick borders, rounded corners, flat colors, no gradients. Professional educational technology brand. Warm cream background (#F5F0E8). Vector-style, clean, minimal. Horizontal layout with logo and mascot side by side."""

def generate_image(prompt: str, output_filename: str):
    """Generate image using Gemini API and save to file"""
    print(f"\n🎨 Generating: {output_filename}")
    print(f"📝 Prompt: {prompt[:100]}...")

    try:
        response = client.models.generate_content(
            model="gemini-3-pro-image-preview",
            contents=[prompt],
        )

        for part in response.parts:
            if part.text is not None:
                print(f"💬 Response text: {part.text}")
            elif part.inline_data is not None:
                image = part.as_image()

                # Create output directory if it doesn't exist
                os.makedirs(os.path.dirname(output_filename), exist_ok=True)

                # Save image
                image.save(output_filename)
                print(f"✅ Saved: {output_filename}")

                # Print image info if available
                try:
                    if hasattr(image, 'size'):
                        print(f"📐 Size: {image.size[0]}x{image.size[1]}px")
                    elif hasattr(image, 'width') and hasattr(image, 'height'):
                        print(f"📐 Size: {image.width}x{image.height}px")
                except:
                    pass  # Skip size info if not available

                return True

        print("⚠️  No image data in response")
        return False

    except Exception as e:
        print(f"❌ Error: {e}")
        return False

def main():
    print("=" * 60)
    print("🐻 LINGUAL LOGO & MASCOT GENERATOR")
    print("=" * 60)

    # Create output directory
    output_dir = "generated_logos"
    os.makedirs(output_dir, exist_ok=True)

    # Generate individual components
    print("\n1️⃣  Generating Logo (wordmark with speech bubble L)...")
    generate_image(LOGO_PROMPT, f"{output_dir}/lingual_logo.png")

    print("\n2️⃣  Generating Mascot (geometric bear)...")
    generate_image(MASCOT_PROMPT, f"{output_dir}/lingual_mascot.png")

    print("\n3️⃣  Generating Combined (logo + mascot)...")
    generate_image(COMBINED_PROMPT, f"{output_dir}/lingual_combined.png")

    print("\n" + "=" * 60)
    print("✨ Generation complete! Check the 'generated_logos' folder")
    print("=" * 60)

if __name__ == "__main__":
    main()
