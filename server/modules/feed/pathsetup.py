"""把项目根放进 sys.path，以便 `from engine.feed import ...`（server/ 是工作目录）。"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
