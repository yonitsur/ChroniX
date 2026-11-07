"""
ChroniX Token & Cost Benchmark Script
Runs a full timeline generation and prints the comprehensive token and cost breakdown.

Usage:
    python backend/measure_tokens.py "The History of Ancient Rome" [--grounding]
"""

import sys
import asyncio
import argparse
import os
import time

# Ensure backend directory is in path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))

from services.gemini_service import generate_timeline_with_gemini

async def main():
    parser = argparse.ArgumentParser(description="Measure token usage and cost for ChroniX timeline generation.")
    parser.add_argument("prompt", nargs="?", default="The Complete History of the Roman Empire - Comprehensive 50 Events", help="Topic for the timeline")
    parser.add_argument("--grounding", action="store_true", help="Enable Google Search Grounding")
    parser.add_argument("--focus", default=None, help="Custom focus for the timeline")
    args = parser.parse_args()

    print("\n" + "=" * 78)
    print(f"Starting Timeline Generation Benchmark...")
    print(f"Topic:        {args.prompt}")
    print(f"Grounding:    {'Enabled' if args.grounding else 'Disabled'}")
    print(f"Focus:        {args.focus or 'None'}")
    print("=" * 78 + "\n")

    try:
        t0 = time.time()
        timeline = await generate_timeline_with_gemini(
            prompt=args.prompt,
            custom_focus=args.focus,
            enable_grounding=args.grounding
        )
        total_bench_duration = time.time() - t0
        print("\nSUCCESS!")
        print(f"Timeline Title: {timeline.title}")
        print(f"Events Count:   {len(timeline.articles)}")
        print(f"Lanes Count:    {len(timeline.lanes)}")
        print(f"Total Duration: {total_bench_duration:.2f}s")
        if timeline.tokenUsage:
            print("\nToken Usage & Timing Metadata:")
            for k, v in timeline.tokenUsage.items():
                print(f"  {k}: {v}")
    except Exception as e:
        print(f"\nERROR: {e}")
        sys.exit(1)

if __name__ == "__main__":
    asyncio.run(main())
