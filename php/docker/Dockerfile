# Development/test image only (not for production): Apache 2.4 + PHP 8.3 with mod_rewrite,
# mod_headers and AllowOverride All, so the real .htaccess files are exercised.
# Used by php/dev.sh, which mounts php/ at /app and a data directory at /data.
FROM php:8.3-apache

RUN apt-get update \
	&& apt-get install -y --no-install-recommends sqlite3 \
	&& rm -rf /var/lib/apt/lists/* \
	&& a2enmod rewrite headers \
	&& cp "$PHP_INI_DIR/php.ini-production" "$PHP_INI_DIR/php.ini" \
	&& printf '%s\n' \
		'<VirtualHost *:80>' \
		'	DocumentRoot /app/public' \
		'	<Directory /app>' \
		'		AllowOverride All' \
		'		Require all granted' \
		'	</Directory>' \
		'	ErrorLog ${APACHE_LOG_DIR}/error.log' \
		'	CustomLog ${APACHE_LOG_DIR}/access.log combined' \
		'</VirtualHost>' \
		> /etc/apache2/sites-available/000-default.conf

# Run Apache as the host user (HOST_UID/HOST_GID) so files in the mounted data directory stay theirs.
RUN printf '%s\n' \
		'#!/bin/sh' \
		'set -e' \
		'if [ -n "${HOST_UID:-}" ] && [ "$HOST_UID" != 0 ]; then' \
		'	groupmod -o -g "${HOST_GID:-$HOST_UID}" www-data' \
		'	usermod -o -u "$HOST_UID" -g "${HOST_GID:-$HOST_UID}" www-data' \
		'fi' \
		'exec apache2-foreground' \
		> /usr/local/bin/dev-entrypoint \
	&& chmod +x /usr/local/bin/dev-entrypoint
CMD ["dev-entrypoint"]
