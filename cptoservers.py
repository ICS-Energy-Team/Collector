import sys
import paramiko
import argparse

servers = { 'main' : { 'ip':'193.232.208.43', 'username':'virt-11', 'pw':'B9fd_vW7', 'path':'collector/' },
            'second' : { 'ip':'193.232.208.42', 'username':'virt-02', 'pw':'7ydit-3G', 'path':'collector_reserve/'  },
            'school29' : { 'ip':'192.168.0.44', 'username':'server', 'pw':'cocacola', 'path':'' }
        }


parser = argparse.ArgumentParser(description='Copy to/from remote server.')

parser.add_argument('server', choices=list(servers), help='a server name')
parser.add_argument('files', metavar='F', nargs='+', help='a file to copy')
parser.add_argument('--from', dest='direction', action='store_const',
                    const='from', default='to',
                    help='copy files from remote server (default: copy to)')

args = parser.parse_args()

serv = servers[args.server]

s = paramiko.SSHClient()
s.set_missing_host_key_policy(paramiko.AutoAddPolicy())
s.connect(serv['ip'],22,username=serv['username'],password=serv['pw'],timeout=4)

sftp = s.open_sftp()
if args.direction == 'to':
    for f in args.files:
        print('copy '+f)
        sftp.put(f, f"/home/{serv['username']}/{serv['path']}{f}")
elif args.direction == 'from':
    for f in args.files:
        print('copy '+f)
        sftp.get(f"/home/{serv['username']}/{serv['path']}{f}", f)
