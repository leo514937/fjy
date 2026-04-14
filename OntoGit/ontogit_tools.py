import os
import json
import urllib.request
import argparse

GATEWAY_URL = "http://127.0.0.1:8080"
API_KEY = "change-me"

def call_api(path, method="GET", data=None):
    url = f"{GATEWAY_URL}{path}"
    headers = {
        "X-API-Key": API_KEY,
        "Content-Type": "application/json"
    }
    
    encoded_data = None
    if data:
        encoded_data = json.dumps(data).encode("utf-8")
        
    req = urllib.request.Request(url, data=encoded_data, headers=headers, method=method)
    
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        return {"error": str(e)}

def write_and_infer(project_id, filename, data, message):
    """写入数据并触发概率推理"""
    payload = {
        "project_id": project_id,
        "filename": filename,
        "data": data,
        "message": message
    }
    return call_api("/xg/write-and-infer", method="POST", data=payload)

def read_ontology(project_id, filename):
    """读取本体数据"""
    return call_api(f"/xg/read/{project_id}/{filename}")

def get_timelines(project_id):
    """获取项目时间线"""
    return call_api(f"/xg/timelines/{project_id}")

def get_projects():
    """列出所有项目"""
    return call_api("/xg/projects")

def analyze_probability(data):
    """对本体数据进行概率推理分析"""
    return call_api("/probability/api/llm/probability-reason", method="POST", data=data)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="OntoGit QAgent Tool Bridge")
    subparsers = parser.add_subparsers(dest="command")
    
    # Write
    p_write = subparsers.add_parser("write")
    p_write.add_argument("--project", required=True)
    p_write.add_argument("--file", required=True)
    p_write.add_argument("--data", required=True, help="JSON string of ontology data")
    p_write.add_argument("--msg", default="QAgent update")
    
    # Read
    p_read = subparsers.add_parser("read")
    p_read.add_argument("--project", required=True)
    p_read.add_argument("--file", required=True)
    
    # List
    p_list = subparsers.add_parser("list")
    
    # Infer
    p_infer = subparsers.add_parser("infer")
    p_infer.add_argument("--data", required=True)
    
    args = parser.parse_args()
    
    if args.command == "write":
        print(json.dumps(write_and_infer(args.project, args.file, json.loads(args.data), args.msg), indent=2, ensure_ascii=False))
    elif args.command == "read":
        print(json.dumps(read_ontology(args.project, args.file), indent=2, ensure_ascii=False))
    elif args.command == "list":
        print(json.dumps(get_projects(), indent=2, ensure_ascii=False))
    elif args.command == "infer":
        print(json.dumps(analyze_probability(json.loads(args.data)), indent=2, ensure_ascii=False))
