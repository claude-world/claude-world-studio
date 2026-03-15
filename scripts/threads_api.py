#!/usr/bin/env python3
"""
Threads API Client — Full lifecycle: search, analyze, generate, publish.
Based on Meta's official Threads API (graph.threads.net/v1.0).

Tokens are auto-loaded from ../.env (relative to this script).
Use --account to select which account (cw or lf). --token overrides env.

Usage:
  python threads_api.py me                                    # uses THREADS_TOKEN_CW from .env
  python threads_api.py me --account lf                       # uses THREADS_TOKEN_LF from .env
  python threads_api.py search --query "AI" --limit 20
  python threads_api.py publish --text "Your post content" --account lf
  python threads_api.py batch-publish --file posts.json --delay 1800
  python threads_api.py schedule --file posts.json --times "21:00,12:00,07:30"
  python threads_api.py me --token TOKEN                      # explicit token overrides .env
"""

import argparse
import json
import sys
import time
import os
from datetime import datetime, timedelta
from urllib.request import Request, urlopen
from urllib.parse import urlencode, quote
from urllib.error import HTTPError


def load_env():
    """Load .env file from the skill root (one level up from scripts/)."""
    env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".env")
    env_path = os.path.normpath(env_path)
    if not os.path.isfile(env_path):
        return
    with open(env_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" not in line:
                continue
            key, value = line.split("=", 1)
            key, value = key.strip(), value.strip()
            if key and key not in os.environ:
                os.environ[key] = value


load_env()


def resolve_token(args):
    """Resolve the API token from --token flag or environment variables."""
    if args.token:
        return args.token
    account = getattr(args, "account", "cw")
    if account == "lf":
        token = os.environ.get("THREADS_TOKEN_LF")
    else:
        token = os.environ.get("THREADS_TOKEN_CW")
    if not token:
        # Fallback to generic THREADS_ACCESS_TOKEN
        token = os.environ.get("THREADS_ACCESS_TOKEN")
    if not token:
        print("Error: No token provided. Use --token or set THREADS_TOKEN_CW / THREADS_TOKEN_LF in .env", file=sys.stderr)
        sys.exit(1)
    return token


API_BASE = "https://graph.threads.net/v1.0"


class ThreadsAPI:
    def __init__(self, access_token: str):
        self.token = access_token
        self.user_id = None
        self.username = None
        self.rate_limit_remaining = None

    def _request(self, method: str, endpoint: str, params: dict = None, data: dict = None) -> dict:
        """Make an API request to Threads."""
        url = f"{API_BASE}{endpoint}"

        if params is None:
            params = {}
        params["access_token"] = self.token

        if method == "GET":
            url += "?" + urlencode(params)
            req = Request(url, method="GET")
        else:
            url += "?" + urlencode({"access_token": self.token})
            body = urlencode({k: v for k, v in (data or params).items() if k != "access_token"})
            req = Request(url, data=body.encode(), method="POST")
            req.add_header("Content-Type", "application/x-www-form-urlencoded")

        try:
            with urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode())
        except HTTPError as e:
            error_body = e.read().decode()
            print(f"API Error {e.code}: {error_body}", file=sys.stderr)
            raise

    # ── Identity ──

    def get_me(self) -> dict:
        """Get current user profile."""
        data = self._request("GET", "/me", {
            "fields": "id,username,name,threads_profile_picture_url,threads_biography"
        })
        self.user_id = data.get("id")
        self.username = data.get("username", data.get("name", "unknown"))
        return data

    # ── Search ──

    def search(self, query: str, limit: int = 20) -> list:
        """
        Search Threads for posts matching a keyword.
        Returns posts sorted by heat score.
        Rate limit: 500 queries per rolling 7 days.
        """
        data = self._request("GET", "/keyword_search", {
            "q": query,
            "fields": "id,text,username,timestamp,like_count,reply_count,repost_count",
            "limit": str(min(limit, 50))
        })
        posts = data.get("data", [])

        # Calculate heat score for each post
        for post in posts:
            likes = post.get("like_count", 0) or 0
            replies = post.get("reply_count", 0) or 0
            reposts = post.get("repost_count", 0) or 0
            post["heat_score"] = likes + (replies * 3) + (reposts * 5)

        # Sort by heat score descending
        posts.sort(key=lambda p: p["heat_score"], reverse=True)
        return posts

    def search_multiple(self, queries: list, limit_per_query: int = 10) -> dict:
        """Search multiple keywords and return results grouped by query."""
        results = {}
        for q in queries:
            try:
                posts = self.search(q, limit_per_query)
                results[q] = posts
                time.sleep(1)  # Rate limit courtesy
            except Exception as e:
                print(f"Search failed for '{q}': {e}", file=sys.stderr)
                results[q] = []
        return results

    # ── Publishing ──

    def create_container(self, text: str, reply_to: str = None,
                         image_url: str = None, poll_options: list = None) -> str:
        """
        Create a media container for a post.
        Returns the creation_id needed for publishing.
        Text limit: 500 characters.
        Supports: text, image, poll attachments.
        Poll options: list of 2-4 strings (max 25 chars each).
        """
        if len(text) > 500:
            print(f"WARNING: Text is {len(text)} chars, truncating to 500", file=sys.stderr)
            text = text[:497] + "..."

        if not self.user_id:
            self.get_me()

        if image_url:
            params = {
                "media_type": "IMAGE",
                "image_url": image_url,
                "text": text,
            }
        else:
            params = {
                "media_type": "TEXT",
                "text": text,
            }

        if reply_to:
            params["reply_to_id"] = reply_to

        if poll_options and not image_url:
            poll = {}
            keys = ["option_a", "option_b", "option_c", "option_d"]
            for i, opt in enumerate(poll_options[:4]):
                poll[keys[i]] = opt[:25]
            params["poll_attachment"] = json.dumps(poll)

        data = self._request("POST", f"/{self.user_id}/threads", data=params)
        return data.get("id")

    def publish_container(self, creation_id: str) -> dict:
        """Publish a previously created media container."""
        if not self.user_id:
            self.get_me()

        data = self._request("POST", f"/{self.user_id}/threads_publish", data={
            "creation_id": creation_id
        })
        return data

    def publish_text(self, text: str, image_url: str = None,
                     poll_options: list = None, link_comment: str = None) -> dict:
        """
        Full publish flow: create container → wait → publish.
        If link_comment is provided, auto-reply with the link (avoids reach penalty).
        If poll_options is provided, attach a native poll (2-4 options, max 25 chars each).
        """
        container_id = self.create_container(text, image_url=image_url,
                                             poll_options=poll_options)
        if not container_id:
            raise Exception("Failed to create media container")

        # Wait for processing (Meta recommends at least a few seconds)
        time.sleep(5)

        result = self.publish_container(container_id)
        post_id = result.get("id")

        output = {
            "post_id": post_id,
            "container_id": container_id,
            "text_length": len(text),
            "published_at": datetime.now().isoformat()
        }

        # Auto-reply with link to avoid reach penalty from URL in main post
        if link_comment and post_id:
            time.sleep(3)
            try:
                reply_cid = self.create_container(link_comment, reply_to=post_id)
                time.sleep(5)
                reply_result = self.publish_container(reply_cid)
                output["link_reply_id"] = reply_result.get("id")
                print(f"  ✓ Link reply posted: {output['link_reply_id']}", file=sys.stderr)
            except Exception as e:
                output["link_reply_error"] = str(e)
                print(f"  ✗ Link reply failed: {e}", file=sys.stderr)

        if poll_options:
            output["poll_options"] = poll_options[:4]
        if image_url:
            output["image_url"] = image_url

        return output

    def publish_thread(self, posts: list) -> list:
        """
        Publish a thread (串文) — a series of connected posts.
        First post is the parent, subsequent posts are replies.
        """
        results = []
        parent_id = None

        for i, text in enumerate(posts):
            if i == 0:
                result = self.publish_text(text)
                parent_id = result["post_id"]
            else:
                container_id = self.create_container(text, reply_to=parent_id)
                time.sleep(5)
                pub = self.publish_container(container_id)
                result = {
                    "post_id": pub.get("id"),
                    "container_id": container_id,
                    "text_length": len(text),
                    "reply_to": parent_id,
                    "published_at": datetime.now().isoformat()
                }

            results.append(result)
            time.sleep(3)  # Brief pause between thread posts

        return results

    def batch_publish(self, posts: list, delay_seconds: int = 1800) -> list:
        """
        Publish multiple independent posts with delay between each.
        Default delay: 30 minutes (1800 seconds).
        """
        results = []
        total = len(posts)

        for i, post in enumerate(posts):
            text = post if isinstance(post, str) else post.get("text", "")
            print(f"[{i+1}/{total}] Publishing ({len(text)} chars)...", file=sys.stderr)

            try:
                result = self.publish_text(text)
                result["index"] = i
                result["status"] = "published"
                results.append(result)
                print(f"  ✓ Published: {result['post_id']}", file=sys.stderr)
            except Exception as e:
                results.append({
                    "index": i,
                    "status": "failed",
                    "error": str(e),
                    "text_preview": text[:50]
                })
                print(f"  ✗ Failed: {e}", file=sys.stderr)

            if i < total - 1:
                print(f"  Waiting {delay_seconds}s before next post...", file=sys.stderr)
                time.sleep(delay_seconds)

        return results


# ── CLI ──

def cmd_me(args):
    token = resolve_token(args)
    api = ThreadsAPI(token)
    data = api.get_me()
    print(json.dumps(data, indent=2, ensure_ascii=False))


def cmd_search(args):
    token = resolve_token(args)
    api = ThreadsAPI(token)
    api.get_me()

    if args.multi:
        queries = [q.strip() for q in args.query.split(",")]
        results = api.search_multiple(queries, args.limit)
        output = {
            "searched_at": datetime.now().isoformat(),
            "queries": queries,
            "results": {}
        }
        for q, posts in results.items():
            output["results"][q] = {
                "count": len(posts),
                "top_heat": posts[0]["heat_score"] if posts else 0,
                "posts": posts[:args.limit]
            }
    else:
        posts = api.search(args.query, args.limit)
        output = {
            "searched_at": datetime.now().isoformat(),
            "query": args.query,
            "count": len(posts),
            "posts": posts
        }

    print(json.dumps(output, indent=2, ensure_ascii=False))


def cmd_publish(args):
    token = resolve_token(args)
    api = ThreadsAPI(token)
    api.get_me()

    if args.thread:
        # Split text by "---" delimiter for thread posts
        parts = [p.strip() for p in args.text.split("---") if p.strip()]
        results = api.publish_thread(parts)
    else:
        poll_opts = None
        if args.poll:
            poll_opts = [o.strip() for o in args.poll.split("|") if o.strip()]
        results = api.publish_text(
            args.text,
            image_url=args.image,
            poll_options=poll_opts,
            link_comment=args.link_comment,
        )

    print(json.dumps(results, indent=2, ensure_ascii=False))


def cmd_batch_publish(args):
    token = resolve_token(args)
    api = ThreadsAPI(token)
    api.get_me()

    with open(args.file, "r", encoding="utf-8") as f:
        data = json.load(f)

    posts = data if isinstance(data, list) else data.get("posts", [])
    results = api.batch_publish(posts, args.delay)

    output = {
        "batch_id": datetime.now().strftime("%Y%m%d_%H%M%S"),
        "total": len(posts),
        "published": sum(1 for r in results if r.get("status") == "published"),
        "failed": sum(1 for r in results if r.get("status") == "failed"),
        "delay_seconds": args.delay,
        "results": results
    }
    print(json.dumps(output, indent=2, ensure_ascii=False))


def cmd_schedule(args):
    """Generate a scheduling plan based on optimal posting times."""
    with open(args.file, "r", encoding="utf-8") as f:
        data = json.load(f)

    posts = data if isinstance(data, list) else data.get("posts", [])

    # Parse target times
    if args.times:
        times = [t.strip() for t in args.times.split(",")]
    else:
        # Default optimal times from patent analysis
        times = ["21:00", "12:00", "17:30", "07:30"]

    now = datetime.now()
    schedule = []

    for i, post in enumerate(posts):
        text = post if isinstance(post, str) else post.get("text", "")
        time_slot = times[i % len(times)]
        hour, minute = map(int, time_slot.split(":"))

        target = now.replace(hour=hour, minute=minute, second=0)
        if target <= now:
            target += timedelta(days=1)
        target += timedelta(days=i // len(times))

        schedule.append({
            "index": i,
            "text_preview": text[:60] + "..." if len(text) > 60 else text,
            "text_length": len(text),
            "scheduled_time": target.isoformat(),
            "time_slot": time_slot,
            "full_text": text
        })

    output = {
        "schedule_created": now.isoformat(),
        "total_posts": len(posts),
        "time_slots": times,
        "schedule": schedule
    }
    print(json.dumps(output, indent=2, ensure_ascii=False))

    # If --execute flag, actually wait and publish
    if args.execute:
        token = resolve_token(args)
        api = ThreadsAPI(token)
        api.get_me()
        print(f"\n--- EXECUTING SCHEDULE (User: @{api.username}) ---", file=sys.stderr)

        for item in schedule:
            target_time = datetime.fromisoformat(item["scheduled_time"])
            wait_seconds = (target_time - datetime.now()).total_seconds()

            if wait_seconds > 0:
                print(f"Waiting {wait_seconds:.0f}s until {item['time_slot']}...", file=sys.stderr)
                time.sleep(wait_seconds)

            try:
                result = api.publish_text(item["full_text"])
                print(f"✓ [{item['index']+1}] Published at {item['time_slot']}: {result['post_id']}", file=sys.stderr)
            except Exception as e:
                print(f"✗ [{item['index']+1}] Failed: {e}", file=sys.stderr)


def main():
    parser = argparse.ArgumentParser(description="Threads API Client")
    sub = parser.add_subparsers(dest="command")

    # me
    me_parser = sub.add_parser("me", help="Get current user info")
    me_parser.add_argument("--token", default=None, help="Access token (falls back to .env)")
    me_parser.add_argument("--account", choices=["cw", "lf"], default="cw", help="Account alias (configure tokens in .env)")

    # search
    search_parser = sub.add_parser("search", help="Search trending posts")
    search_parser.add_argument("--token", default=None, help="Access token (falls back to .env)")
    search_parser.add_argument("--account", choices=["cw", "lf"], default="cw", help="Account alias (configure tokens in .env)")
    search_parser.add_argument("--query", "-q", required=True)
    search_parser.add_argument("--limit", "-l", type=int, default=20)
    search_parser.add_argument("--multi", action="store_true", help="Comma-separated queries")

    # publish
    pub_parser = sub.add_parser("publish", help="Publish a single post")
    pub_parser.add_argument("--token", default=None, help="Access token (falls back to .env)")
    pub_parser.add_argument("--account", choices=["cw", "lf"], default="cw", help="Account alias (configure tokens in .env)")
    pub_parser.add_argument("--text", "-t", required=True)
    pub_parser.add_argument("--image", default=None, help="Public image URL to attach")
    pub_parser.add_argument("--poll", default=None, help="Poll options separated by | (2-4, max 25 chars each)")
    pub_parser.add_argument("--link-comment", default=None, help="Auto-reply with this link (avoids reach penalty)")
    pub_parser.add_argument("--thread", action="store_true", help="Split by --- into thread")

    # batch-publish
    batch_parser = sub.add_parser("batch-publish", help="Publish multiple posts")
    batch_parser.add_argument("--token", default=None, help="Access token (falls back to .env)")
    batch_parser.add_argument("--account", choices=["cw", "lf"], default="cw", help="Account alias (configure tokens in .env)")
    batch_parser.add_argument("--file", "-f", required=True)
    batch_parser.add_argument("--delay", "-d", type=int, default=1800)

    # schedule
    sched_parser = sub.add_parser("schedule", help="Schedule posts at optimal times")
    sched_parser.add_argument("--token", default=None, help="Access token (falls back to .env)")
    sched_parser.add_argument("--account", choices=["cw", "lf"], default="cw", help="Account alias (configure tokens in .env)")
    sched_parser.add_argument("--file", "-f", required=True)
    sched_parser.add_argument("--times", help="Comma-separated times, e.g. '21:00,12:00'")
    sched_parser.add_argument("--execute", action="store_true", help="Actually wait and publish")

    args = parser.parse_args()

    commands = {
        "me": cmd_me,
        "search": cmd_search,
        "publish": cmd_publish,
        "batch-publish": cmd_batch_publish,
        "schedule": cmd_schedule,
    }

    if args.command in commands:
        commands[args.command](args)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
