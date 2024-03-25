#!/usr/bin/python3

import sys
import re

def read_schema(filename):
	table_names = []
	with open(filename, 'r') as f:
		for line in f:
			match = re.match(r'// WITHOUT-ROWID: (\S+)', line)
			if match:
				table_names.append(match.group(1))
	return table_names

def extract_table_name(create_table_line):
	match = re.match(r'CREATE TABLE `(\S+)`', create_table_line)
	if match:
		return match.group(1)
	return None

def modify_sql_file(sql_filename, table_names):
	modified_lines = []
	in_create_table = False
	current_table_name = None

	with open(sql_filename, 'r') as f:
		for line in f.readlines():
			if line.startswith('CREATE TABLE'):
				in_create_table = True
				current_table_name = extract_table_name(line)

			if in_create_table:
				if line.strip().endswith(');'):
					if current_table_name in table_names:
						line = line.strip().replace(');', ') WITHOUT ROWID;')
					in_create_table = False
					current_table_name = None

			modified_lines.append(line)

	for line in modified_lines:
		print(line, end='')

if __name__ == '__main__':
	if len(sys.argv) != 3:
		print(f'usage: python3 {sys.argv[0]} <schema> <sql_file>', file=sys.stderr)
		sys.exit(1)

	table_names = read_schema(sys.argv[1])
	print(f'WITHOUT-ROWID: {table_names}', file=sys.stderr)
	modify_sql_file(sys.argv[2], table_names)