import os
import re

patterns = [
    re.compile(r' +Oasis\r?\n'),
    re.compile(r' +Riverside\r?\n'),
    re.compile(r' +Glastonbury\r?\n'),
    re.compile(r'^Oasis\r?\n', re.M),
    re.compile(r'^Riverside\r?\n', re.M),
    re.compile(r'\n +Oasis$', re.M),
    re.compile(r'\n +Riverside$', re.M),
]

def cleanup_file(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    new_content = content
    for pattern in patterns:
        new_content = pattern.sub('', new_content)
    
    if new_content != content:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(new_content)
        print(f"Fixed: {filepath}")

for root, dirs, files in os.walk('.'):
    if '.venv' in dirs:
        dirs.remove('.venv')
    if 'node_modules' in dirs:
        dirs.remove('node_modules')
    if '.next' in dirs:
        dirs.remove('.next')
        
    for file in files:
        if file.endswith(('.py', '.tsx', '.ts')):
            cleanup_file(os.path.join(root, file))
