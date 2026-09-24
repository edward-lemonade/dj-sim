# x86_64. For arm64/Graviton: change the base tag to a -arm64 flavor if you
# use one, and swap the ffmpeg download below for the "arm64" static build.
FROM public.ecr.aws/lambda/python:3.12

# Static ffmpeg build — librosa/audioread shells out to ffmpeg for mp3/aac/
# etc. decoding, and the base image has no package manager entry for it.
RUN dnf install -y tar xz && \
    curl -L -o /tmp/ffmpeg.tar.xz https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz && \
    tar -xJf /tmp/ffmpeg.tar.xz -C /tmp && \
    cp /tmp/ffmpeg-*-amd64-static/ffmpeg /usr/local/bin/ffmpeg && \
    cp /tmp/ffmpeg-*-amd64-static/ffprobe /usr/local/bin/ffprobe && \
    rm -rf /tmp/ffmpeg* && \
    dnf remove -y tar xz && dnf clean all

ENV PATH="/usr/local/bin:${PATH}"

COPY requirements.txt ${LAMBDA_TASK_ROOT}/
RUN pip install --no-cache-dir -r ${LAMBDA_TASK_ROOT}/requirements.txt

COPY handler.py ${LAMBDA_TASK_ROOT}/

CMD ["handler.handler"]