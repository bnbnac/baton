FROM alpine:latest

RUN apk add --no-cache bash openssh sudo \
    && adduser -D -s /bin/bash batonfixture \
    && echo 'batonfixture:baton-fixture-only' | chpasswd \
    && echo 'batonfixture ALL=(ALL:ALL) ALL' > /etc/sudoers.d/batonfixture \
    && chmod 0440 /etc/sudoers.d/batonfixture \
    && mkdir -p /run/sshd \
    && ssh-keygen -A

RUN printf '%s\n' \
    'Port 22' \
    'ListenAddress 0.0.0.0' \
    'HostKey /etc/ssh/ssh_host_ed25519_key' \
    'PasswordAuthentication yes' \
    'KbdInteractiveAuthentication no' \
    'PermitRootLogin no' \
    'UsePAM no' \
    'AllowUsers batonfixture' \
    'AllowTcpForwarding no' \
    'X11Forwarding no' \
    'PermitTunnel no' \
    'PermitTTY yes' \
    'LogLevel ERROR' \
    > /etc/ssh/sshd_config

EXPOSE 22
CMD ["/usr/sbin/sshd", "-D", "-e"]
